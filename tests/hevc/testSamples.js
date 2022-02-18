'use strict';

console.time(__filename.split('/').pop());

const { readFileSync } = require('fs');

const assert = require('assert');

const Mp4Frag = require('../../index');

const list = require('./list.json');

const filename = 'pipe:1';

(async () => {
  for (const item of list) {
    const [videoCodec] = item.split(',');

    const filename = `${__dirname}/samples/${videoCodec}-init.mp4`;

    const file = readFileSync(filename);

    const mp4frag = new Mp4Frag();

    await new Promise((resolve, reject) => {
      mp4frag.once('error', error => {
        console.error({ error });

        reject(error);
      });

      mp4frag.once('initialized', ({ mime }) => {
        console.log({ mime });
        assert(videoCodec === mp4frag.videoCodec, `${videoCodec} vs ${mp4frag.videoCodec}`);

        resolve();
      });

      mp4frag.write(file);
    });
  }

  console.timeEnd(__filename.split('/').pop());
})();
