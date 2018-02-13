'use strict';

console.time('=====> test7.js');

const assert = require('assert');

const Mp4Frag = require('../index');

const ffmpegPath = require('ffmpeg-static').path;

const { spawn } = require('child_process');

const fs = require('fs');

const count = 20;//expected count of segments

const fps = 24;//number of frames per second(same as input video) might not be necessary

const scale =  640;//used as width of video, height will automatically scale

let counter = 0;

const params = [
    /* log info to console */
    '-loglevel', 'quiet',
    '-stats',

    /* use hardware acceleration if available */
    '-hwaccel', 'auto',
    
    /* use an artificial video input */
    //'-re',
    '-i', `${__dirname}/in/BigBuckBunny63MB.mp4`,

    /* set output flags */
    //'-an',
    '-c:a', 'aac',
    '-c:v', 'libx264',
    '-movflags', '+faststart+frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset',
    '-f', 'mp4',
    '-vf', `fps=${fps},scale=${scale}:-1,format=yuv420p`,
    '-profile:v', 'main',
    '-level', '3.1',
    '-crf', '25',
    '-metadata', 'title=test mp4',
    '-reset_timestamps', '1',
    '-frag_duration', '30000000',//make ffmpeg create segments that are 30 seconds duration
    '-min_frag_duration', '30000000',//make ffmpeg create segments that are 30 seconds duration
    'pipe:1'
];

const mp4frag = new Mp4Frag();

mp4frag.on('initialized', (data)=> {
    const writeStream = fs.createWriteStream(`${__dirname}/out/init.mp4`);
    writeStream.end(data.initialization);
});

mp4frag.on('segment', (data)=> {
    const writeStream = fs.createWriteStream(`${__dirname}/out/seg-${counter}.m4s`);
    writeStream.end(data);
    counter++;
});

mp4frag.on('error', (data)=> {
    //error is expected when ffmpeg exits without unpiping
    console.log('mp4frag error', data);
});

const ffmpeg = spawn(ffmpegPath, params, {stdio: ['ignore', 'pipe', 'inherit']});

ffmpeg.on('error', (error) => {
    console.log('ffmpeg error', error);
});

ffmpeg.on('exit', (code, signal) => {
    assert(counter === count, `${counter} !== ${count}`);
    assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);
    console.timeEnd('=====> test7.js');
});

ffmpeg.stdio[1].pipe(mp4frag);