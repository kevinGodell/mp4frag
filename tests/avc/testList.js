'use strict';

console.time(__filename.split('/').pop());

const { spawnSync } = require('child_process');

const assert = require('assert');

const Mp4Frag = require('../../index');

const ffmpegPath = require('../../lib/ffmpeg');

const getParams = require('./getParams');

const list = require('./list.json');

const filename = 'pipe:1';

(async () => {
  for (const item of list) {
    const [videoCodec, profile, level, pixFmt, keyint] = item.split(',');

    const params = getParams({ profile, level, pixFmt, keyint, filename });

    const ffmpeg = spawnSync(ffmpegPath, params, { stdio: ['ignore', 'pipe', 'pipe'] });

    if (ffmpeg.status === 0) {
      const mp4frag = new Mp4Frag();

      await new Promise((resolve, reject) => {
        mp4frag.once('error', error => {
          console.error(error);

          reject(error);
        });

        mp4frag.once('initialized', () => {
          assert(videoCodec === mp4frag.videoCodec, `${videoCodec} vs ${mp4frag.videoCodec}`);

          resolve();
        });

        mp4frag.write(ffmpeg.stdout);
      });
    } else {
      console.log(ffmpeg.stderr.toString());
    }
  }

  console.timeEnd(__filename.split('/').pop());
})();
