'use strict';

console.time(__filename.split('/').pop());

const { readFileSync } = require('fs');

const assert = require('assert');

const Mp4Frag = require('../../index');

const list = require('./list.json');

(async () => {
  try {
    for (const item of list) {
      const [audioCodec] = item.split(',');

      const filename = `${__dirname}/samples/${audioCodec}-init.mp4`;

      const file = readFileSync(filename);

      const mp4frag = new Mp4Frag();

      await new Promise((resolve, reject) => {
        mp4frag.once('error', error => {
          reject(error);
        });

        mp4frag.once('initialized', ({ mime }) => {
          console.log({ mime });

          assert(audioCodec === mp4frag.audioCodec, `expected: ${audioCodec}, received: ${mp4frag.audioCodec}`);

          resolve();
        });

        mp4frag.write(file);
      });
    }
  } catch (error) {
    console.error(error.toString());
  }

  console.timeEnd(__filename.split('/').pop());
})();
