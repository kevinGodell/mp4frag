'use strict';

console.time('🎉 =====> various_configs');

const assert = require('assert');

const { spawn } = require('child_process');

const ffmpegPath = require('../../lib/ffmpeg');

const Mp4Frag = require('../../index');

const tests = [
  {
    frameLimit: 200,
    gop: 10,
    scale: 640,
    fps: 10,
    mp4fragConfig: { hlsPlaylistBase: `test`, hlsPlaylistSize: 5 },
  },
  {
    frameLimit: 200,
    gop: 5,
    scale: 640,
    fps: 10,
    mp4fragConfig: { hlsPlaylistBase: 'TEST', hlsPlaylistSize: 10 },
  },
  {
    frameLimit: 200,
    gop: 100,
    scale: 640,
    fps: 10,
    mp4fragConfig: { hlsPlaylistBase: 'Te_St', hlsPlaylistSize: 3, hlsPlaylistExtra: 2 },
  },
  {
    frameLimit: 200,
    gop: 10,
    scale: 320,
    fps: 10,
    mp4fragConfig: { segmentCount: 12 },
  },
  {
    frameLimit: 200,
    gop: 10,
    scale: 320,
    fps: 10,
    mp4fragConfig: { pool: 1 },
  },
  {
    frameLimit: 200,
    gop: 10,
    scale: 640,
    fps: 100,
    mp4fragConfig: null,
  },
  {
    frameLimit: 200,
    gop: 100,
    scale: 640,
    fps: 10,
    mp4fragConfig: { hlsPlaylistBase: 'TeSt', hlsPlaylistSize: 7, hlsPlaylistExtra: 5, pool: 1 },
  },
  {
    frameLimit: 200,
    gop: 10,
    scale: 320,
    fps: 10,
    mp4fragConfig: { segmentCount: 12, pool: 1 },
  },
];

(async () => {
  for (let i = 0; i < tests.length; ++i) {
    const consoleTime = `✅  test-${i}`;

    console.time(consoleTime);

    await new Promise((resolve, reject) => {
      const { frameLimit, gop, scale, fps, mp4fragConfig } = tests[i];

      const count = Math.ceil(frameLimit / gop);

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
        `title=test mp4 ${i}`,
        'pipe:1',
      ];

      const mp4frag = new Mp4Frag(mp4fragConfig);

      mp4frag.once('initialized', data => {
        assert(data.mime === 'video/mp4; codecs="avc1.4D401F"', `${data.mime} !== video/mp4; codecs="avc1.4D401F"`);
      });

      mp4frag.on('segment', data => {
        counter++;
        /*if (counter === count) {
          console.log(mp4frag.toJSON());
        }*/
      });

      mp4frag.once('error', error => {
        reject(error);
      });

      const ffmpeg = spawn(ffmpegPath, params, { stdio: ['ignore', 'pipe', 'ignore'] });

      ffmpeg.once('error', error => {
        reject(error);
      });

      ffmpeg.once('exit', (code, signal) => {
        // console.log(mp4frag.toJSON()); // end: false

        assert(counter === count, `${counter} !== ${count}`);

        assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);

        resolve(i);
      });

      ffmpeg.stdio[1].pipe(mp4frag, { end: true });
    });

    console.timeEnd(consoleTime);
  }

  console.timeEnd('🎉 =====> various_configs');
})();
