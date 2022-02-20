'use strict';

console.time(__filename.split('/').pop());

const { spawnSync } = require('child_process');

const { writeFileSync } = require('fs');

const Mp4Frag = require('../../index');

const ffmpegPath = require('../../lib/ffmpeg');

const getParams = require('./getParams');

const { profiles } = require('./config');

const sort = (a, b) => {
  const aParts = a.split('.');

  const bParts = b.split('.');

  if (parseInt(aParts[1]) < parseInt(bParts[1])) {
    return -1;
  }

  if (parseInt(bParts[1]) < parseInt(aParts[1])) {
    return 1;
  }

  if (parseInt(aParts[2]) < parseInt(bParts[2])) {
    return -1;
  }

  if (parseInt(bParts[2]) < parseInt(aParts[2])) {
    return 1;
  }

  return 0;
};

const results = [];

const audioCodecSet = new Set();

let total = profiles.length;

(async () => {
  try {
      for (const profile of profiles) {

                const params = getParams({ profile });

                const ffmpeg = spawnSync(ffmpegPath, params, { stdio: ['ignore', 'pipe', 'pipe'] });

                if (ffmpeg.status === 0) {
                  const mp4frag = new Mp4Frag();

                  await new Promise((resolve, reject) => {
                    mp4frag.once('error', error => {
                      reject(error);
                    });

                    /*mp4frag.once('segment', data => {
                      console.log(data);
                    });*/

                    mp4frag.once('initialized', () => {
                      const { audioCodec } = mp4frag;

                      if (audioCodecSet.has(audioCodec) === false) {
                        audioCodecSet.add(audioCodec);

                        results.push([audioCodec, profile].join(','));
                      }

                      resolve();
                    });

                    mp4frag.write(ffmpeg.stdout);
                  });
                } else {
                  console.warn(`profile:${profile}`);

                  console.warn(ffmpeg.stderr.toString());
                }

                console.log(--total, audioCodecSet.size);


      }


    const data = JSON.stringify(results.sort(sort), null, 1);

    writeFileSync(`${__dirname}/list.json`, data);
  } catch (error) {
    console.error(error.toString());
  }

  console.timeEnd(__filename.split('/').pop());
})();
