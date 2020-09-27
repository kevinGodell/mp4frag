'use strict';

const { Transform } = require('stream');

const _FTYP = Buffer.from([0x66, 0x74, 0x79, 0x70]); // ftyp
const _MOOV = Buffer.from([0x6d, 0x6f, 0x6f, 0x76]); // moov
const _MOOF = Buffer.from([0x6d, 0x6f, 0x6f, 0x66]); // moof
const _MFRA = Buffer.from([0x6d, 0x66, 0x72, 0x61]); // mfra
const _MDAT = Buffer.from([0x6d, 0x64, 0x61, 0x74]); // mdat
const _MP4A = Buffer.from([0x6d, 0x70, 0x34, 0x61]); // mp4a
const _AVCC = Buffer.from([0x61, 0x76, 0x63, 0x43]); // avcC
const _HLS_DEF = 4; // hls list size default
const _HLS_MIN = 2; // hls list size minimum
const _HLS_MAX = 10; // hls list size maximum
const _HLS_EXTRA_MAX = 5; // hls extra segments in memory
const _SEG_DEF = 2; // segment list size default
const _SEG_MIN = 2; // segment list size minimum
const _SEG_MAX = 15; // segment list size maximum

/**
 * @fileOverview Creates a stream transform for piping a fmp4 (fragmented mp4) from ffmpeg.
 * Can be used to generate a fmp4 m3u8 HLS playlist and compatible file fragments.
 * Can also be used for storing past segments of the mp4 video in a buffer for later access.
 * Must use the following ffmpeg flags <b><i>-movflags +frag_keyframe+empty_moov+default_base_moof</i></b> to generate a fmp4
 * with a compatible file structure : ftyp+moov -> moof+mdat -> moof+mdat -> moof+mdat ...
 * @requires stream.Transform
 */
class Mp4Frag extends Transform {
  /**
   * @constructor
   * @param {Object} [options] - Configuration options.
   * @param {String} [options.hlsBase] - Base name of files in m3u8 playlist. Affects the generated m3u8 playlist by naming file fragments. Must be set to generate m3u8 playlist. e.g. 'front_door'
   * @param {Number} [options.hlsListSize = 4] - Number of segments to use in m3u8 playlist. Must be an integer ranging from 2 to 10.
   * @param {Number} [options.hlsListExtra = 0] - Number of extra segments to keep in memory. Must be an integer ranging from 0 to 5.
   * @param {Boolean} [options.hlsListInit = true] - Indicates that m3u8 playlist should be generated after init segment is created and before media segments are created.
   * @param {Number} [options.segmentCount = 2] - Number of segments to keep in memory. Has no effect if using options.hlsBase. Must be an integer ranging from 2 to 15.
   * @returns {Mp4Frag} this - Returns reference to new instance of Mp4Frag for chaining event listeners.
   * @throws Will throw an error if options.hlsBase contains characters other than letters(a-zA-Z) and underscores(_).
   */
  constructor(options) {
    super(options);
    if (options) {
      if (options.hasOwnProperty('hlsBase')) {
        if (/[^a-z_]/gi.test(options.hlsBase)) {
          throw new Error('hlsBase must only contain letters and underscores');
        }

        this._hlsBase = options.hlsBase;

        this._hlsListInit = Mp4Frag._validateBoolean(options.hlsListInit, true);

        this._hlsListSize = Mp4Frag._validateNumber(options.hlsListSize, _HLS_DEF, _HLS_MIN, _HLS_MAX);

        this._hlsListExtra = Mp4Frag._validateNumber(options.hlsListExtra, 0, 0, _HLS_EXTRA_MAX);

        this._segmentCount = this._hlsListSize + this._hlsListExtra;

        this._segments = [];
      } else if (options.hasOwnProperty('segmentCount')) {
        this._segmentCount = Mp4Frag._validateNumber(options.segmentCount, _SEG_DEF, _SEG_MIN, _SEG_MAX);

        this._segments = [];
      }
    }

    this._sequence = -1;

    this._parseChunk = this._findFtyp;

    return this;
  }

  /**
   * @param {*|Number|String} number
   * @param {Number} def
   * @param {Number} min
   * @param {Number} max
   * @return {Number}
   * @private
   */
  static _validateNumber(number, def, min, max) {
    number = Number.parseInt(number);
    if (isNaN(number)) {
      return def;
    }
    if (number < min) {
      return min;
    }
    if (number > max) {
      return max;
    }
    return number;
  }

  /**
   * @param {*|Boolean} bool
   * @param {Boolean} def
   * @return {Boolean}
   * @private
   */
  static _validateBoolean(bool, def) {
    return typeof bool === 'boolean' ? bool : def;
  }

  /**
   * @readonly
   * @property {String|null} mime
   * - Returns the mime codec information as a <b>String</b>.
   * <br/>
   * - Returns <b>Null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
   * @returns {String|null}
   */
  get mime() {
    return this._mime || null;
  }

  /**
   * @readonly
   * @property {Buffer|null} initialization
   * - Returns the Mp4 initialization fragment as a <b>Buffer</b>.
   * <br/>
   * - Returns <b>Null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
   * @returns {Buffer|null}
   */
  get initialization() {
    return this._initialization || null;
  }

  /**
   * @readonly
   * @property {Buffer|null} segment
   * - Returns the latest Mp4 segment as a <b>Buffer</b>.
   * <br/>
   * - Returns <b>Null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {Buffer|null}
   */
  get segment() {
    return this._segment || null;
  }

  /**
   * @readonly
   * @property {Object} segmentObject
   * - Returns the latest Mp4 segment as an <b>Object</b>.
   * <br/>
   *  - <b><code>{buffer, sequence, duration, timestamp}</code></b>
   * <br/>
   * - Returns <b>Null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {Object}
   */
  get segmentObject() {
    return {
      buffer: this.segment,
      sequence: this.sequence,
      duration: this.duration,
      timestamp: this.timestamp
    };
  }

  /**
   * @readonly
   * @property {Number} timestamp
   * - Returns the timestamp of the latest Mp4 segment as an <b>Integer</b>(<i>milliseconds</i>).
   * <br/>
   * - Returns <b>-1</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {Number}
   */
  get timestamp() {
    return this._timestamp || -1;
  }

  /**
   * @readonly
   * @property {Number} duration
   * - Returns the duration of latest Mp4 segment as a <b>Float</b>(<i>seconds</i>).
   * <br/>
   * - Returns <b>-1</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {Number}
   */
  get duration() {
    return this._duration || -1;
  }

  /**
   * @readonly
   * @property {String|null} m3u8
   * - Returns the fmp4 HLS m3u8 playlist as a <b>String</b>.
   * <br/>
   * - Returns <b>Null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
   * @returns {String|null}
   */
  get m3u8() {
    return this._m3u8 || null;
  }

  /**
   * @readonly
   * @property {Number} sequence
   * - Returns the sequence of the latest Mp4 segment as an <b>Integer</b>.
   * <br/>
   * - Returns <b>-1</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {Number}
   */
  get sequence() {
    return Number.isInteger(this._sequence) ? this._sequence : -1;
  }

  /**
   * @readonly
   * @property {Array|null} segmentObjectList
   * - Returns the Mp4 segments as an <b>Array</b> of <b>Objects</b>
   * <br/>
   * - <b><code>[{buffer, sequence, duration, timestamp},...]</code></b>
   * <br/>
   * - Returns <b>Null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {Array|null}
   */
  get segmentObjectList() {
    if (this._segments && this._segments.length > 0) {
      return this._segments;
    }
    return null;
  }

  /**
   * @readonly
   * @property {Buffer|null} segmentList
   * - Returns the Mp4 segments concatenated as a single <b>Buffer</b>.
   * <br/>
   * - Returns <b>Null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {Buffer|null}
   */
  get segmentList() {
    if (this._segments && this._segments.length > 0) {
      const temp = this._segments.map(({ buffer }) => buffer);
      return Buffer.concat(temp);
    }
    return null;
  }

  /**
   * @readonly
   * @property {Buffer|null} buffer
   * - Returns the [Mp4Frag.initialization]{@link Mp4Frag#initialization} and [Mp4Frag.segmentList]{@link Mp4Frag#segmentList} concatenated as a single <b>Buffer</b>.
   * <br/>
   * - Returns <b>Null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {Buffer|null}
   */
  get buffer() {
    if (this._initialization && this._segments && this._segments.length > 0) {
      const temp = this._segments.map(({ buffer }) => buffer);
      return Buffer.concat([this._initialization, ...temp]);
    }
    return null;
  }

  /**
   * @param {Number|String} sequence
   * - Returns the Mp4 segment that corresponds to the numbered sequence as a <b>Buffer</b>.
   * <br/>
   * - Returns <b>Null</b> if there is no segment that corresponds to sequence number.
   * @returns {Buffer|null}
   */
  getSegment(sequence) {
    sequence = Number.parseInt(sequence);
    if (sequence >= 0 && this._segments && this._segments.length > 0) {
      for (let i = 0; i < this._segments.length; i++) {
        if (this._segments[i].sequence === sequence) {
          return this._segments[i].buffer;
        }
      }
    }
    return null;
  }

  /**
   * @param {Number|String} sequence
   * - Returns the Mp4 segment that corresponds to the numbered sequence as an <b>Object</b>.
   * <br/>
   * - <b><code>{buffer, sequence, duration, timestamp}</code></b>
   * <br/>
   * - Returns <b>Null</b> if there is no segment that corresponds to sequence number.
   * @returns {Object|null}
   */
  getSegmentObject(sequence) {
    sequence = Number.parseInt(sequence);
    if (sequence >= 0 && this._segments && this._segments.length > 0) {
      for (let i = 0; i < this._segments.length; i++) {
        if (this._segments[i].sequence === sequence) {
          return this._segments[i];
        }
      }
    }
    return null;
  }

  /**
   * Search buffer for ftyp.
   * @private
   */
  _findFtyp(chunk) {
    const chunkLength = chunk.length;
    if (chunkLength < 8 || chunk.indexOf(_FTYP) !== 4) {
      this.emit('error', new Error(`${_FTYP.toString()} not found.`));
      return;
    }
    this._ftypLength = chunk.readUInt32BE(0, true);
    if (this._ftypLength < chunkLength) {
      this._ftyp = chunk.slice(0, this._ftypLength);
      this._parseChunk = this._findMoov;
      this._parseChunk(chunk.slice(this._ftypLength));
    } else if (this._ftypLength === chunkLength) {
      this._ftyp = chunk;
      this._parseChunk = this._findMoov;
    } else {
      //should not be possible to get here because ftyp is approximately 24 bytes
      //will have to buffer this chunk and wait for rest of it on next pass
      this.emit('error', new Error(`ftypLength:${this._ftypLength} > chunkLength:${chunkLength}`));
      //return;
    }
  }

  /**
   * Search buffer for moov.
   * @private
   */
  _findMoov(chunk) {
    const chunkLength = chunk.length;
    if (chunkLength < 8 || chunk.indexOf(_MOOV) !== 4) {
      this.emit('error', new Error(`${_MOOV.toString()} not found.`));
      return;
    }
    const moovLength = chunk.readUInt32BE(0, true);
    if (moovLength < chunkLength) {
      this._parseMoov(Buffer.concat([this._ftyp, chunk], this._ftypLength + moovLength));
      delete this._ftyp;
      delete this._ftypLength;
      this._parseChunk = this._findMoof;
      this._parseChunk(chunk.slice(moovLength));
    } else if (moovLength === chunkLength) {
      this._parseMoov(Buffer.concat([this._ftyp, chunk], this._ftypLength + moovLength));
      delete this._ftyp;
      delete this._ftypLength;
      this._parseChunk = this._findMoof;
    } else {
      //probably should not arrive here here because moov is typically < 800 bytes
      //will have to store chunk until size is big enough to have entire moov piece
      //ffmpeg may have crashed before it could output moov and got us here
      this.emit('error', new Error(`moovLength:${moovLength} > chunkLength:${chunkLength}`));
      //return;
    }
  }

  /**
   * Parse moov for mime.
   * @fires Mp4Frag#initialized
   * @private
   */
  _parseMoov(value) {
    this._initialization = value;
    let audioString = '';
    if (this._initialization.indexOf(_MP4A) !== -1) {
      audioString = ', mp4a.40.2';
    }
    let index = this._initialization.indexOf(_AVCC);
    if (index === -1) {
      this.emit('error', new Error(`${_AVCC.toString()} codec info not found.`));
      return;
    }
    index += 5;
    this._mime = `video/mp4; codecs="avc1.${this._initialization
      .slice(index, index + 3)
      .toString('hex')
      .toUpperCase()}${audioString}"`;
    this._timestamp = Date.now();
    // todo should not create playlist until first segment is cut because targetduration should not change
    if (this._hlsBase && this._hlsListInit) {
      let m3u8 = '#EXTM3U\n';
      m3u8 += '#EXT-X-VERSION:7\n';
      m3u8 += `#EXT-X-TARGETDURATION:1\n`;
      m3u8 += `#EXT-X-MEDIA-SEQUENCE:0\n`;
      m3u8 += `#EXT-X-MAP:URI="init-${this._hlsBase}.mp4"\n`;
      this._m3u8 = m3u8;
    }
    /**
     * Fires when the init fragment of the Mp4 is parsed from the piped data.
     * @event Mp4Frag#initialized
     * @type {Event}
     * @property {Object} Object
     * @property {String} Object.mime - [Mp4Frag.mime]{@link Mp4Frag#mime}
     * @property {Buffer} Object.initialization - [Mp4Frag.initialization]{@link Mp4Frag#initialization}
     * @property {String} Object.m3u8 - [Mp4Frag.m3u8]{@link Mp4Frag#m3u8}
     */
    this.emit('initialized', { mime: this.mime, initialization: this.initialization, m3u8: this.m3u8 });
  }

  /**
   * Find moof after miss due to corrupt data in pipe.
   * @private
   */
  _moofHunt(chunk) {
    if (this._moofHunts < this._moofHuntsLimit) {
      this._moofHunts++;
      //console.warn(`MOOF hunt attempt number ${this._moofHunts}.`);
      const index = chunk.indexOf(_MOOF);
      if (index > 3 && chunk.length > index + 3) {
        delete this._moofHunts;
        delete this._moofHuntsLimit;
        this._parseChunk = this._findMoof;
        this._parseChunk(chunk.slice(index - 4));
      }
    } else {
      this.emit('error', new Error(`${_MOOF.toString()} hunt failed after ${this._moofHunts} attempts.`));
      //return;
    }
  }

  /**
   * Search buffer for moof.
   * @private
   */
  _findMoof(chunk) {
    if (this._moofBuffer) {
      this._moofBuffer.push(chunk);
      const chunkLength = chunk.length;
      this._moofBufferSize += chunkLength;
      if (this._moofLength === this._moofBufferSize) {
        //todo verify this works
        this._moof = Buffer.concat(this._moofBuffer, this._moofLength);
        delete this._moofBuffer;
        delete this._moofBufferSize;
        this._parseChunk = this._findMdat;
      } else if (this._moofLength < this._moofBufferSize) {
        this._moof = Buffer.concat(this._moofBuffer, this._moofLength);
        const sliceIndex = chunkLength - (this._moofBufferSize - this._moofLength);
        delete this._moofBuffer;
        delete this._moofBufferSize;
        this._parseChunk = this._findMdat;
        this._parseChunk(chunk.slice(sliceIndex));
      }
    } else {
      const chunkLength = chunk.length;
      if (chunkLength < 8 || chunk.indexOf(_MOOF) !== 4) {
        //ffmpeg occasionally pipes corrupt data, lets try to get back to normal if we can find next MOOF box before attempts run out
        const mfraIndex = chunk.indexOf(_MFRA);
        if (mfraIndex !== -1) {
          //console.log(`MFRA was found at ${mfraIndex}. This is expected at the end of stream.`);
          return;
        }
        //console.warn('Failed to find MOOF. Starting MOOF hunt. Ignore this if your file stream input has ended.');
        this._moofHunts = 0;
        this._moofHuntsLimit = 40;
        this._parseChunk = this._moofHunt;
        this._parseChunk(chunk);
        return;
      }
      this._moofLength = chunk.readUInt32BE(0, true);
      if (this._moofLength === 0) {
        this.emit('error', new Error(`Bad data from input stream reports ${_MOOF.toString()} length of 0.`));
        return;
      }
      if (this._moofLength < chunkLength) {
        this._moof = chunk.slice(0, this._moofLength);
        this._parseChunk = this._findMdat;
        this._parseChunk(chunk.slice(this._moofLength));
      } else if (this._moofLength === chunkLength) {
        //todo verify this works
        this._moof = chunk;
        this._parseChunk = this._findMdat;
      } else {
        this._moofBuffer = [chunk];
        this._moofBufferSize = chunkLength;
      }
    }
  }

  /**
   * Process current segment.
   * @fires Mp4Frag#segment
   * @param chunk {Buffer}
   * @private
   */
  _setSegment(chunk) {
    this._segment = chunk;
    const currentTime = Date.now();
    this._duration = Math.max((currentTime - this._timestamp) / 1000, 1);
    this._timestamp = currentTime;
    this._sequence++;
    if (this._segments) {
      this._segments.push({
        buffer: this._segment,
        sequence: this._sequence,
        duration: this._duration,
        timestamp: this._timestamp
      });
      while (this._segments.length > this._segmentCount) {
        this._segments.shift();
      }
      if (this._hlsBase) {
        let i = this._segments.length > this._hlsListSize ? this._segments.length - this._hlsListSize : 0;
        let m3u8 = '#EXTM3U\n';
        m3u8 += '#EXT-X-VERSION:7\n';
        m3u8 += `#EXT-X-TARGETDURATION:${Math.round(this._duration)}\n`;
        m3u8 += `#EXT-X-MEDIA-SEQUENCE:${this._segments[i].sequence}\n`;
        m3u8 += `#EXT-X-MAP:URI="init-${this._hlsBase}.mp4"\n`;
        for (i; i < this._segments.length; i++) {
          m3u8 += `#EXTINF:${this._segments[i].duration.toFixed(6)},\n`;
          m3u8 += `${this._hlsBase}${this._segments[i].sequence}.m4s\n`;
        }
        this._m3u8 = m3u8;
      }
    }
    if (this._readableState.pipesCount > 0) {
      this.push(this._segment);
    }
    /**
     * Fires when the latest Mp4 segment is parsed from the piped data.
     * @event Mp4Frag#segment
     * @type {Event}
     * @property {Object} Object - [Mp4Frag.segmentObject]{@link Mp4Frag#segmentObject}
     * @property {Buffer} Object.buffer - [Mp4Frag.segment]{@link Mp4Frag#segment}
     * @property {Number} Object.sequence - [Mp4Frag.sequence]{@link Mp4Frag#sequence}
     * @property {Number} Object.duration - [Mp4Frag.duration]{@link Mp4Frag#duration}
     * @property {Number} Object.timestamp - [Mp4Frag.timestamp]{@link Mp4Frag#timestamp}
     */
    this.emit('segment', this.segmentObject);
  }

  /**
   * Search buffer for mdat.
   * @private
   */
  _findMdat(chunk) {
    if (this._mdatBuffer) {
      this._mdatBuffer.push(chunk);
      const chunkLength = chunk.length;
      this._mdatBufferSize += chunkLength;
      if (this._mdatLength === this._mdatBufferSize) {
        this._setSegment(Buffer.concat([this._moof, ...this._mdatBuffer], this._moofLength + this._mdatLength));
        delete this._moof;
        delete this._mdatBuffer;
        delete this._mdatBufferSize;
        delete this._mdatLength;
        delete this._moofLength;
        this._parseChunk = this._findMoof;
      } else if (this._mdatLength < this._mdatBufferSize) {
        this._setSegment(Buffer.concat([this._moof, ...this._mdatBuffer], this._moofLength + this._mdatLength));
        const sliceIndex = chunkLength - (this._mdatBufferSize - this._mdatLength);
        delete this._moof;
        delete this._mdatBuffer;
        delete this._mdatBufferSize;
        delete this._mdatLength;
        delete this._moofLength;
        this._parseChunk = this._findMoof;
        this._parseChunk(chunk.slice(sliceIndex));
      }
    } else {
      const chunkLength = chunk.length;
      if (chunkLength < 8 || chunk.indexOf(_MDAT) !== 4) {
        this.emit('error', new Error(`${_MDAT.toString()} not found.`));
        return;
      }
      this._mdatLength = chunk.readUInt32BE(0, true);
      if (this._mdatLength > chunkLength) {
        this._mdatBuffer = [chunk];
        this._mdatBufferSize = chunkLength;
      } else if (this._mdatLength === chunkLength) {
        this._setSegment(Buffer.concat([this._moof, chunk], this._moofLength + chunkLength));
        delete this._moof;
        delete this._moofLength;
        delete this._mdatLength;
        this._parseChunk = this._findMoof;
      } else {
        this._setSegment(Buffer.concat([this._moof, chunk], this._moofLength + this._mdatLength));
        const sliceIndex = this._mdatLength;
        delete this._moof;
        delete this._moofLength;
        delete this._mdatLength;
        this._parseChunk = this._findMoof;
        this._parseChunk(chunk.slice(sliceIndex));
      }
    }
  }

  /**
   * Required for stream transform.
   * @private
   */
  _transform(chunk, encoding, callback) {
    this._parseChunk(chunk);
    callback();
  }

  /**
   * Run cleanup when unpiped.
   * @private
   */
  _flush(callback) {
    this.resetCache();
    callback();
  }

  /**
   * Clear cached values
   */
  resetCache() {
    this._parseChunk = this._findFtyp;
    this._sequence = -1;
    if (this._segments) {
      this._segments = [];
    }
    delete this._mime;
    delete this._initialization;
    delete this._segment;
    delete this._timestamp;
    delete this._duration;
    delete this._moof;
    delete this._mdatBuffer;
    delete this._moofLength;
    delete this._mdatLength;
    delete this._mdatBufferSize;
    delete this._ftyp;
    delete this._ftypLength;
    delete this._m3u8;
  }
}

module.exports = Mp4Frag;
