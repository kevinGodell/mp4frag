'use strict';

console.time('=====> split_chunk');

const assert = require('assert');

const Mp4Frag = require('../../index');

const { readFileSync } = require('fs');

const { join } = require('path');

const init = readFileSync(join(__dirname, '../in/init.mp4'));

const segment = readFileSync(join(__dirname, '../in/segment.m4s'));

const mp4frag = new Mp4Frag();

let sequence = 0;

let loops = 0;

const maxLoops = 100;

const byteLength = segment.byteLength;

mp4frag.once('initialized', data => {
  assert(data.mime === 'video/mp4; codecs="avc1.4D401F, mp4a.40.2"', `${data.mime} !== video/mp4; codecs="avc1.4D401F, mp4a.40.2"`);
  assert(data.initialization.equals(init));
});

mp4frag.on('segment', data => {
  assert(data.sequence === sequence++);
  assert(data.duration === 0.06494140625);
  assert(data.keyframe === true);
  assert(data.segment.equals(segment));
});

mp4frag.once('error', err => {
  console.log('mp4frag error', err.message);
});

mp4frag.write(init);

while (++loops <= maxLoops) {
  for (let i = 1; i <= byteLength; ++i) {
    const sub0 = segment.subarray(0, i);

    const sub1 = segment.subarray(i);

    mp4frag.write(sub0);

    mp4frag.write(sub1);
  }
}

assert(mp4frag.sequence + 1 === byteLength * maxLoops);

console.timeEnd('=====> split_chunk');
