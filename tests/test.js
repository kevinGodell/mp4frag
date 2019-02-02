'use strict';

console.time('=====> test.js');

const assert = require('assert');

const Mp4Frag = require('../index');

const ffmpegPath = require('ffmpeg-static').path;

const { spawn } = require('child_process');

const frameLimit = 200;

const gop = 10;

const count = Math.ceil(frameLimit/gop);//expected number of segments to be cut from ffmpeg

const scale =  640;

const fps = 10;

let counter = 0;

const params = [
    /* log info to console */
    '-loglevel', 'quiet',
    '-stats',

    /* use hardware acceleration if available */
    '-hwaccel', 'auto',
    
    /* use an artificial video input */
    //'-re',
    '-f', 'lavfi',
    '-i', 'testsrc=size=1280x720:rate=20',

    /* set output flags */
    '-an',
    '-c:v', 'libx264',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    '-vf', `fps=${fps},scale=${scale}:-1,format=yuv420p`,
    '-frames', frameLimit,
    '-g', gop,
    '-profile:v', 'main',
    '-level', '3.1',
    '-crf', '25',
    '-metadata', 'title=test mp4',
    'pipe:1'
];

const hlsBase = 'someHlsBase';

const mp4frag = new Mp4Frag({hlsBase: hlsBase, hlsListSize: 5});

mp4frag.once('initialized', (data)=> {
    assert(data.mime === 'video/mp4; codecs="avc1.4D401F"', `${data.mime} !== video/mp4; codecs="avc1.4D401F"`);
});

mp4frag.on('segment', (data)=> {
    counter++;
    console.log(mp4frag.sequence, data.length, mp4frag.segment.length, mp4frag.getHlsSegment(mp4frag.sequence).length, mp4frag.getHlsNamedSegment(`${hlsBase}${mp4frag.sequence}.m4s`).length);
});

mp4frag.once('error', (err)=> {
    //error is expected when ffmpeg exits without unpiping
    console.log('mp4frag error', err.message);
});

const ffmpeg = spawn(ffmpegPath, params, {stdio: ['ignore', 'pipe', 'inherit']});

ffmpeg.once('error', (error) => {
    console.log('ffmpeg error', error);
});

ffmpeg.once('exit', (code, signal) => {
    assert(counter === count, `${counter} !== ${count}`);
    assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);
    console.timeEnd('=====> test.js');
});

ffmpeg.stdio[1].pipe(mp4frag);
