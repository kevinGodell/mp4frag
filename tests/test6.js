'use strict';

console.time('=====> test6.js');

//const assert = require('assert');

const Mp4Frag = require('../index');

const { spawn } = require('child_process');

const fs = require('fs');

//const frameLimit = 200;

const gop = 15;

//const count = Math.ceil(frameLimit/gop);//expected number of segments to be cut from ffmpeg

const scale =  640;

const fps = 15;

let counter = 0;

const params = [
    /* log info to console */
    '-loglevel', 'quiet',
    '-stats',

    /* use hardware acceleration if available */
    '-hwaccel', 'auto',
    
    /* use an artificial video input */
    //'-re',
    //'-f', 'lavfi',
    //'-i', 'testsrc=size=1280x720:rate=20',
    '-i',
    './in/test.mp4',

    /* set output flags */
    '-an',
    '-c:v', 'libx264',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    '-vf', `fps=${fps},scale=${scale}:-1,format=yuv420p`,
    //'-frames', frameLimit,
    '-g', gop,
    '-profile:v', 'main',
    '-level', '3.1',
    '-crf', '25',
    '-metadata', 'title=test mp4',
    'pipe:1'
];

const mp4frag = new Mp4Frag();

mp4frag.on('initialized', (data)=> {
    const writeStream = fs.createWriteStream(`./out/init.mp4`);
    writeStream.end(data.initialization);
});

mp4frag.on('segment', (data)=> {
    const writeStream = fs.createWriteStream(`./out/seg-${counter}.m4s`);
    writeStream.end(data);
    counter++;
});

mp4frag.on('error', (data)=> {
    //error is expected when ffmpeg exits without unpiping
    console.log('mp4frag error', data);
});

const ffmpeg = spawn('ffmpeg', params, {stdio: ['ignore', 'pipe', 'inherit']});

ffmpeg.on('error', (error) => {
    console.log('ffmpeg error', error);
});

ffmpeg.on('exit', (code, signal) => {
    //assert(counter === count, `${counter} !== ${count}`);
    //assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);
    console.timeEnd('=====> test6.js');
});

ffmpeg.stdio[1].pipe(mp4frag);