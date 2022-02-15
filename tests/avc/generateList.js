'use strict';

console.time(__filename.split('/').pop());

const { spawnSync } = require('child_process');

const { writeFileSync } = require('fs');

const Mp4Frag = require('../../index');

const ffmpegPath = require('../../lib/ffmpeg');

const getParams = require('./getParams');

const { profiles, levels, pixFmts, keyints } = require('./config');

const results = [];

const videoCodecSet = new Set();

const filename = 'pipe:1';

let total = profiles.length * levels.length * pixFmts.length * keyints.length;

(async () => {
  for (const profile of profiles) {
    for (const level of levels) {
      for (const pixFmt of pixFmts) {
        for (const keyint of keyints) {
          const params = getParams({
            profile,
            level,
            pixFmt,
            keyint,
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

              /*mp4frag.once('segment', data => {
                console.log({ data });
              });*/

              mp4frag.once('initialized', () => {
                const { videoCodec } = mp4frag;

                if (videoCodecSet.has(videoCodec) === false) {
                  console.log({ videoCodec });

                  videoCodecSet.add(videoCodec);

                  results.push([videoCodec, profile, level, pixFmt, keyint].join(','));
                }

                resolve();
              });

              mp4frag.write(ffmpeg.stdout);
            });
          } else {
            console.error(`profile:${profile} level:${level} pixFmt:${pixFmt} keyint:${keyint}`);

            console.error(ffmpeg.stderr.toString());
          }

          console.log(--total, videoCodecSet.size);
          //}
        }
      }
    }
  }

  const data = JSON.stringify(results, null, 1);

  try {
    writeFileSync(`${__dirname}/list.json`, data);
  } catch (error) {
    console.error(error);
  }

  console.timeEnd(__filename.split('/').pop());
})();
