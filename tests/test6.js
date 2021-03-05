'use strict';

console.time('=====> test6.js');

const assert = require('assert');

const Mp4Frag = require('../index');

const ffmpegPath = require('../lib/ffmpeg');

const { spawn } = require('child_process');

const frameLimit = 2001;

const scale = 320;

const fps = 200;

const count = Math.ceil(frameLimit / fps);

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

  '-f',
  'lavfi',
  '-i',
  'anoisesrc=c=pink:r=44100:a=0.5',

  '-map',
  '0:0',
  '-map',
  '1',

  /*'-rtsp_transport', 'tcp',
    '-i', 'rtsp://131.95.3.162:554/axis-media/media.3gp',*/

  /* set output flags */
  //'-an',
  '-c:a',
  'aac',
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
  '-profile:v',
  'main',
  '-level',
  '3.1',
  '-crf',
  '25',
  '-metadata',
  'title=test mp4',
  '-frag_duration',
  '1000000', //make ffmpeg create segments that are 1 second duration
  '-min_frag_duration',
  '1000000', //make ffmpeg create segments that are 1 second duration
  'pipe:1'
];

const mp4frag = new Mp4Frag();

mp4frag.once('initialized', data => {
  assert(
    data.mime === 'video/mp4; codecs="avc1.4D401F, mp4a.40.2"',
    `${data.mime} !== video/mp4; codecs="avc1.4D401F, mp4a.40.2"`
  );
});

mp4frag.on('segment', data => {
  counter++;
});

mp4frag.once('error', data => {
  //error is expected when ffmpeg exits without unpiping
  console.log('mp4frag error', data);
});

const ffmpeg = spawn(ffmpegPath, params, { stdio: ['ignore', 'pipe', 'inherit'] });

ffmpeg.once('error', error => {
  console.log('ffmpeg error', error);
});

ffmpeg.once('exit', (code, signal) => {
  assert(counter === count, `${counter} !== ${count}`);
  assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);
  console.timeEnd('=====> test6.js');
});

ffmpeg.stdio[1].pipe(mp4frag);
