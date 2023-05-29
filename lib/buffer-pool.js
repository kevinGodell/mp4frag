'use strict';

class BufferPool {
  #pool = [];
  #length = 2;

  /**
   * @constructor
   * @param {object} [options] - Configuration options.
   * @param {number} [options.length = 2] - Number of pooled buffers in array. Min 2. Max 32.
   */
  constructor(options) {
    options = options instanceof Object ? options : { length: 2 };
    this.#length = this.#pool.length = BufferPool.#validateInt(options.length, 2, 2, 32);
  }

  static #validateInt(n, def, min, max) {
    n = Number.parseInt(n);
    return Number.isNaN(n) ? def : n < min ? min : n > max ? max : n;
  }

  /**
   * @param {Buffer[]} list - array of Buffer objects (required)
   * @param {number} totalLength - total length of all Buffer objects (required)
   * @returns Buffer
   */
  concat(list, totalLength) {
    const arrayBuffer = this.#pool.shift();
    const buffer = arrayBuffer && arrayBuffer.byteLength >= totalLength ? Buffer.from(arrayBuffer, 0, totalLength) : Buffer.allocUnsafeSlow(totalLength);
    let bytesCopied = 0;
    list.forEach(chunk => {
      bytesCopied += chunk.copy(buffer, bytesCopied);
    });
    this.#pool.push(buffer.buffer);
    return buffer;
  }

  reset() {
    this.#pool.length = 0;
    this.#pool.length = this.#length;
  }
}

module.exports = BufferPool;
