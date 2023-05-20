'use strict';

console.time('=====> readableObjectMode false');

const Mp4Frag = require('../../index');

const ffmpegPath = require('../../lib/ffmpeg');

const { Writable } = require('stream');

const assert = require('assert');

const { spawn } = require('child_process');

const frameLimit = 200;

const gop = 10;

const count = Math.ceil(frameLimit / gop); //expected number of segments to be cut from ffmpeg

const scale = 640;

const fps = 10;

let counter = 0;

const params = [
  /* log info to console */
  '-loglevel',
  'quiet',
  '-stats',

  /* use hardware acceleration if available */
  '-hwaccel',
  'auto',

  /* use an artificial video input */
  //'-re',
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=1280x720:rate=20',

  /* set output flags */
  '-an',
  '-c:v',
  'libx264',
  '-movflags',
  '+frag_keyframe+empty_moov+default_base_moof',
  '-f',
  'mp4',
  '-vf',
  `fps=${fps},scale=${scale}:-1,format=yuv420p`,
  '-frames',
  frameLimit,
  '-g',
  gop,
  '-profile:v',
  'main',
  '-level',
  '3.1',
  '-crf',
  '25',
  '-metadata',
  'title=test mp4',
  'pipe:1',
];

const mp4frag = new Mp4Frag({ readableObjectMode: false });

mp4frag.on('data', (buffer, data) => {
  if (data.type === 'segment') {
    counter++;
  } else if (data.type === 'init') {
    assert(data.mime === 'video/mp4; codecs="avc1.4D401F"', `${data.mime} !== video/mp4; codecs="avc1.4D401F"`);
  }
});

mp4frag.once('error', err => {
  //error is expected when ffmpeg exits without unpiping
  console.log('mp4frag error', err.message);
});

const ffmpeg = spawn(ffmpegPath, params, { stdio: ['ignore', 'pipe', 'ignore'] });

ffmpeg.once('error', error => {
  console.log('ffmpeg error', error);
});

ffmpeg.once('exit', (code, signal) => {
  assert(counter === count, `${counter} !== ${count}`);
  assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);
  console.timeEnd('=====> readableObjectMode false');
});

const writable = new Writable({
  objectMode: false,
  write(chunk, encoding, callback) {
    assert(Buffer.isBuffer(chunk));
    callback();
  },
});

ffmpeg.stdio[1].pipe(mp4frag).pipe(writable);
