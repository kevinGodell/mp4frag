'use strict';

console.time(__filename.split('/').pop());

const { spawnSync } = require('child_process');

const { writeFileSync } = require('fs');

const Mp4Frag = require('../../index');

const ffmpegPath = require('../../lib/ffmpeg');

const getParams = require('./getParams');

const { profiles, levels, pixFmts, keyints } = require('./config');

/*const sort = (a, b) => {
  const aParts = a.split('.');

  const bParts = b.split('.');

  if (aParts[0] === 'hev1' && bParts[0] === 'hvc1') {
    return -1;
  }

  if (bParts[0] === 'hev1' && aParts[0] === 'hvc1') {
    return 1;
  }

  if (aParts[1] < bParts[1]) {
    return -1;
  }

  if (bParts[1] < aParts[1]) {
    return 1;
  }

  if (aParts[2] < bParts[2]) {
    return -1;
  }

  if (bParts[2] < aParts[2]) {
    return 1;
  }

  if (aParts[3].startsWith('L') && bParts[3].startsWith('H')) {
    return -1;
  }

  if (bParts[3].startsWith('L') && aParts[3].startsWith('H')) {
    return 1;
  }

  if (parseInt(aParts[3].substring(1)) < parseInt(bParts[3].substring(1))) {
    return -1;
  }

  if (parseInt(bParts[3].substring(1)) < parseInt(aParts[3].substring(1))) {
    return 1;
  }

  if (aParts[4] < bParts[4]) {
    return -1;
  }

  if (bParts[4] < aParts[4]) {
    return 1;
  }

  return 0;
};*/

const results = [];

const videoCodecSet = new Set();

let total = profiles.length * levels.length * pixFmts.length * keyints.length;

(async () => {
  try {
    for (const profile of profiles) {
      for (const level of levels) {
        for (const pixFmt of pixFmts) {
          for (const keyint of keyints) {
            const params = getParams({ profile, level, pixFmt, keyint });

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
                  const { videoCodec } = mp4frag;

                  if (videoCodecSet.has(videoCodec) === false) {
                    videoCodecSet.add(videoCodec);

                    results.push([videoCodec, profile, level, pixFmt, keyint].join(','));
                  }

                  resolve();
                });

                mp4frag.write(ffmpeg.stdout);
              });
            } else {
              console.warn(`profile:${profile} level:${level} pixFmt:${pixFmt} keyint:${keyint}`);

              console.warn(ffmpeg.stderr.toString());
            }

            console.log(--total, videoCodecSet.size);
          }
        }
      }
    }

    const data = JSON.stringify(results.sort(), null, 1);

    writeFileSync(`${__dirname}/list.json`, data);
  } catch (error) {
    console.error(error.toString());
  }

  console.timeEnd(__filename.split('/').pop());
})();
