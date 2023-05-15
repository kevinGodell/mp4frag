'use strict';

console.time('=====> small_chunk');

const assert = require('assert');

const Mp4Frag = require('../../index');

const { readFileSync } = require('fs');

const { join } = require('path');

const init = readFileSync(join(__dirname, 'init.mp4'));

const segment = readFileSync(join(__dirname, 'segment.m4s'));

const mp4frag = new Mp4Frag();

mp4frag.once('initialized', data => {
  assert(data.mime === 'video/mp4; codecs="avc1.4D401F, mp4a.40.2"', `${data.mime} !== video/mp4; codecs="avc1.4D401F, mp4a.40.2"`);
  assert(data.initialization.equals(init));
});

mp4frag.once('segment', data => {
  assert(data.sequence === 0);
  assert(data.duration === 0.06494140625);
  assert(data.keyframe === true);
  assert(data.segment.equals(segment));
});

mp4frag.once('error', err => {
  console.log('mp4frag error', err.message);
});

const mdatIndex = segment.indexOf(Buffer.from([0x6d, 0x64, 0x61, 0x74]));

const sub0 = segment.subarray(0, 7);

const sub1 = segment.subarray(7, mdatIndex + 3);

const sub2 = segment.subarray(mdatIndex + 3);

mp4frag.write(init);

mp4frag.write(sub0);

mp4frag.write(sub1);

mp4frag.write(sub2);

console.timeEnd('=====> small_chunk');
