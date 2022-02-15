'use strict';

console.time(__filename.split('/').pop());

const { spawnSync } = require('child_process');

const { writeFileSync } = require('fs');

const Mp4Frag = require('../../index');

const ffmpegPath = require('../../lib/ffmpeg');

const getParams = require('./getParams');

const { profiles } = require('./config');

const results = [];

const audioCodecSet = new Set();

const filename = 'pipe:1';

let total = profiles.length;

(async () => {
  for (const profile of profiles) {
    const params = getParams({
      profile,
      filename,
    });

    const ffmpeg = spawnSync(ffmpegPath, params, { stdio: ['ignore', 'pipe', 'pipe'] });

    if (ffmpeg.status === 0) {
      const mp4frag = new Mp4Frag();

      await new Promise((resolve, reject) => {
        mp4frag.once('error', error => {
          console.error(error);

          reject(error);
        });

        /*mp4frag.on('segment', data => {
          console.log({ data });
        });*/

        mp4frag.once('initialized', () => {
          const { audioCodec } = mp4frag;

          if (audioCodecSet.has(audioCodec) === false) {
            console.log({ audioCodec });

            audioCodecSet.add(audioCodec);

            results.push([audioCodec, profile].join(','));
          }

          resolve();
        });

        mp4frag.write(ffmpeg.stdout);
      });
    } else {
      console.error(`profile:${profile}`);

      console.error(ffmpeg.stderr.toString());
    }

    console.log(--total, audioCodecSet.size);
  }

  const data = JSON.stringify(results, null, 1);

  try {
    writeFileSync(`${__dirname}/list.json`, data);
  } catch (error) {
    console.error(error);
  }

  console.timeEnd(__filename.split('/').pop());
})();
