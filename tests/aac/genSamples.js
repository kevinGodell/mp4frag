'use strict';

console.time(__filename.split('/').pop());

const { spawnSync } = require('child_process');

const { writeFileSync } = require('fs');

const Mp4Frag = require('../../index');

const ffmpegPath = require('../../lib/ffmpeg');

const getParams = require('./getParams');

const list = require('./list.json');

(async () => {
  try {
    for (const item of list) {
      const [audioCodec, profile] = item.split(',');

      const params = getParams({ profile });

      const ffmpeg = spawnSync(ffmpegPath, params, { stdio: ['ignore', 'pipe', 'pipe'] });

      await new Promise((resolve, reject) => {
        if (ffmpeg.status === 0) {
          const mp4frag = new Mp4Frag();

          mp4frag.once('error', error => {
            reject(error);
          });

          mp4frag.once('initialized', data => {
            const filename = `${__dirname}/samples/${audioCodec}-init.mp4`;

            writeFileSync(filename, data.initialization);

            console.log(`sample created @ ${filename}`);

            resolve();
          });

          mp4frag.write(ffmpeg.stdout);
        } else {
          console.error(`profile:${profile}`);

          reject(ffmpeg.stderr);
        }
      });
    }
  } catch (error) {
    console.error(error.toString());
  }

  console.timeEnd(__filename.split('/').pop());
})();
