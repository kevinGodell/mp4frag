'use strict';

console.time('=====> test9.js');

const assert = require('assert');

const fs = require('fs');

const path = require('path');

const Mp4Frag = require('../index');

const inputFile = path.join(__dirname, '/in/test2.mp4');

const mp4frag = new Mp4Frag();

let counter = 0;

mp4frag.once('initialized', (data)=> {
    console.log(data);
});

mp4frag.on('segment', (data)=> {
    counter++;
    console.log(data);
});

mp4frag.once('error', (data) => {
    console.log('mp4frag error', data);
});

const readStream = fs.createReadStream(inputFile);

readStream.once('error', (err) => {
    console.error('unable to read file', err);
});

readStream.once('end', () => {
    assert(counter === 47, 'Expected 47 segments.');
});

readStream.pipe(mp4frag);
