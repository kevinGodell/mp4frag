// jshint esversion: 6, globalstrict: true, strict: true
'use strict';

console.time('=====> test.js');

const assert = require('assert');

const Mp4Frag = require('../index');

const { spawn } = require('child_process');

const frameLimit = 100;

const gop = 10;

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
    '-re',
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

const mp4frag = new Mp4Frag();

mp4frag.on('initialized', (data)=> {
    assert(data.initialization.length === 800, `${data.initialization.length} !== 800`);
    assert(data.mime === 'video/mp4; codecs="avc1.4D401F"', `${data.mime} !== video/mp4; codecs="avc1.4D401F"`);
});

mp4frag.on('segment', (data)=> {
    counter++;
});

mp4frag.on('error', (data)=> {
    //error is expected when ffmpeg exits
    //last bit of data will be corrupt
    console.log('error', data);
});

const ffmpeg = spawn('ffmpeg', params, {stdio: ['ignore', 'pipe', 'inherit']});

ffmpeg.on('error', (error) => {
    console.log(error);
});

ffmpeg.on('exit', (code, signal) => {
    assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);
    console.timeEnd('=====> test.js');
});

ffmpeg.stdio[1].pipe(mp4frag);