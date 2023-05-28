'use strict';

const BufferPool = require('./lib/buffer-pool');

const { Transform } = require('stream');

/*
todo after version 0.7.0
const { deprecate } = require('util');
*/

/**
 * @file
 * <ul>
 * <li>Creates a stream transform for piping a fmp4 (fragmented mp4) from ffmpeg.</li>
 * <li>Can be used to generate a fmp4 m3u8 HLS playlist and compatible file fragments.</li>
 * <li>Can be used for storing past segments of the mp4 video in a buffer for later access.</li>
 * <li>Must use the following ffmpeg args <b><i>-movflags +frag_keyframe+empty_moov+default_base_moof</i></b> to generate
 * a valid fmp4 with a compatible file structure : ftyp+moov -> moof+mdat -> moof+mdat ...</li>
 * </ul>
 * @extends stream.Transform
 */
class Mp4Frag extends Transform {
  /* ----> static private fields <---- */
  static #ERR = { invalidArg: 'ERR_INVALID_ARG', chunkParse: 'ERR_CHUNK_PARSE', chunkLength: 'ERR_CHUNK_LENGTH' };
  static #HLS_INIT_DEF = true; // initialize hls playlist before 1st segment
  static #HLS_SIZE = { def: 4, min: 2, max: 20 }; // hls playlist size
  static #HLS_EXTRA = { def: 0, min: 0, max: 10 }; // hls playlist extra segments in memory
  static #SEG_SIZE = { def: 2, min: 2, max: 30 }; // segment list size
  static #FTYP = Mp4Frag.#boxFrom([0x66, 0x74, 0x79, 0x70]); // ftyp
  static #MOOV = Mp4Frag.#boxFrom([0x6d, 0x6f, 0x6f, 0x76]); // moov
  static #MDHD = Mp4Frag.#boxFrom([0x6d, 0x64, 0x68, 0x64]); // mdhd
  static #MOOF = Mp4Frag.#boxFrom([0x6d, 0x6f, 0x6f, 0x66]); // moof
  static #MDAT = Mp4Frag.#boxFrom([0x6d, 0x64, 0x61, 0x74]); // mdat
  static #TFHD = Mp4Frag.#boxFrom([0x74, 0x66, 0x68, 0x64]); // tfhd
  static #TRUN = Mp4Frag.#boxFrom([0x74, 0x72, 0x75, 0x6e]); // trun
  static #MFRA = Mp4Frag.#boxFrom([0x6d, 0x66, 0x72, 0x61]); // mfra
  static #HVCC = Mp4Frag.#boxFrom([0x68, 0x76, 0x63, 0x43]); // hvcC
  static #HEV1 = Mp4Frag.#boxFrom([0x68, 0x65, 0x76, 0x31]); // hev1
  static #HVC1 = Mp4Frag.#boxFrom([0x68, 0x76, 0x63, 0x31]); // hvc1
  static #AVCC = Mp4Frag.#boxFrom([0x61, 0x76, 0x63, 0x43]); // avcC
  static #AVC1 = Mp4Frag.#boxFrom([0x61, 0x76, 0x63, 0x31]); // avc1
  static #AVC2 = Mp4Frag.#boxFrom([0x61, 0x76, 0x63, 0x32]); // avc2
  static #AVC3 = Mp4Frag.#boxFrom([0x61, 0x76, 0x63, 0x33]); // avc3
  static #AVC4 = Mp4Frag.#boxFrom([0x61, 0x76, 0x63, 0x34]); // avc4
  static #MP4A = Mp4Frag.#boxFrom([0x6d, 0x70, 0x34, 0x61]); // mp4a
  static #ESDS = Mp4Frag.#boxFrom([0x65, 0x73, 0x64, 0x73]); // esds

  /* ----> private method placeholders <---- */
  #bufferConcat = Buffer.concat; // will be reassigned if setting pool > 0
  #parseChunk = this.#noop; // reassigned after each box parsing is complete
  #setKeyframe = this.#noop; // placeholder for #setKeyframeAVCC() | #setKeyframeHECC()
  #sendInit = this.#sendInitAsBuffer; // will be reassigned if setting readableObjectMode to true
  #sendSegment = this.#sendSegmentAsBuffer; // will be reassigned if setting readableObjectMode to true

  /* ----> private fields <---- */
  #hlsPlaylist = undefined;
  #segmentCount = 0;
  #bufferPool = 0;
  #poolLength = 0;
  #ftypSize = 0;
  #moovSize = 0;
  #ftypMoovSize = 0;
  #ftypMoovChunks = [];
  #ftypMoovChunksTotalLength = 0;
  #moofSize = 0;
  #mdatSize = 0;
  #moofMdatSize = 0;
  #moofMdatChunks = [];
  #moofMdatChunksTotalLength = 0;
  #smallChunk = undefined; // to be used when chunk is less than 8 bytes and moof/mdat box index cannot be found

  /* ----> private fields with getters (readonly) <---- */
  #initialization;
  #audioCodec;
  #videoCodec;
  #mime;
  #timescale;
  #segment;
  #sequence;
  #duration;
  #timestamp;
  #keyframe;
  #segmentObjects;
  #totalDuration;
  #totalByteLength;
  #allKeyframes;
  #m3u8;

  /**
   * @constructor
   * @param {object} [options] - Configuration options.
   * @param {boolean} [options.readableObjectMode = false] - If true, segments will be piped out as an object instead of a Buffer.
   * @param {string} [options.hlsPlaylistBase] - Base name of files in m3u8 playlist. Must only contain letters and underscores. Must be set to generate m3u8 playlist. e.g. 'front_door'.
   * @param {number} [options.hlsPlaylistSize = 4] - Number of segments to use in m3u8 playlist. Must be an integer ranging from 2 to 20.
   * @param {number} [options.hlsPlaylistExtra = 0] - Number of extra segments to keep in memory. Must be an integer ranging from 0 to 10.
   * @param {boolean} [options.hlsPlaylistInit = true] - Indicates that m3u8 playlist should be generated after [initialization]{@link Mp4Frag#initialization} is created and before media segments are created.
   * @param {number} [options.segmentCount = 2] - Number of segments to keep in memory. If using hlsPlaylistBase, value will be calculated from hlsPlaylistSize + hlsPlaylistExtra. Must be an integer ranging from 2 to 30.
   * @param {number} [options.pool = 0] - Reuse pooled ArrayBuffer allocations to reduce garbage collection. Set to 1 to activate. Experimental.
   */
  constructor(options) {
    options = options instanceof Object ? options : {};
    super({ writableObjectMode: false, readableObjectMode: options.readableObjectMode === true });
    if (typeof options.hlsPlaylistBase !== 'undefined') {
      if (/[^a-z_]/gi.test(options.hlsPlaylistBase)) {
        return process.nextTick(() => {
          this.#emitError('hlsPlaylistBase must only contain underscores and letters (_, a-z, A-Z)', Mp4Frag.#ERR.invalidArg);
        });
      }
      this.#hlsPlaylist = {
        base: options.hlsPlaylistBase,
        init: Mp4Frag.#validateBool(options.hlsPlaylistInit, Mp4Frag.#HLS_INIT_DEF),
        size: Mp4Frag.#validateInt(options.hlsPlaylistSize, Mp4Frag.#HLS_SIZE.def, Mp4Frag.#HLS_SIZE.min, Mp4Frag.#HLS_SIZE.max),
        extra: Mp4Frag.#validateInt(options.hlsPlaylistExtra, Mp4Frag.#HLS_EXTRA.def, Mp4Frag.#HLS_EXTRA.min, Mp4Frag.#HLS_EXTRA.max),
      };
      this.#segmentCount = this.#hlsPlaylist.size + this.#hlsPlaylist.extra;
      this.#segmentObjects = [];
    } else if (typeof options.segmentCount !== 'undefined') {
      this.#segmentCount = Mp4Frag.#validateInt(options.segmentCount, Mp4Frag.#SEG_SIZE.def, Mp4Frag.#SEG_SIZE.min, Mp4Frag.#SEG_SIZE.max);
      this.#segmentObjects = [];
    }
    if (options.pool > 0) {
      this.#poolLength = (this.#segmentCount || 1) + options.pool;
      this.#bufferPool = new BufferPool({ length: this.#poolLength });
      this.#bufferConcat = this.#bufferPool.concat.bind(this.#bufferPool);
    }
    if (options.readableObjectMode === true) {
      this.#sendInit = this.#sendInitAsObject;
      this.#sendSegment = this.#sendSegmentAsObject;
    }
    /*
    todo after version 0.7.0
    this.on('newListener', event => {
      if (event === 'initialized') {
        deprecate(() => {}, '"initialized" event will be removed in version >= 0.8.0. Please use "data" event and check for type: init.')();
      } else if (event === 'segment') {
        deprecate(() => {}, '"segment" event will be removed in version >= 0.8.0. Please use "data" event and check for type: segment.')();
      }
    });
    */
    this.#parseChunk = this.#findFtyp;
  }

  /**
   * @readonly
   * @property {string|null} audioCodec
   * - Returns the audio codec information as a <b>string</b>.
   * <br/>
   * - Returns <b>null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
   * @returns {string|null}
   */
  get audioCodec() {
    return this.#audioCodec || null;
  }

  /**
   * @readonly
   * @property {string|null} videoCodec
   * - Returns the video codec information as a <b>string</b>.
   * <br/>
   * - Returns <b>null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
   * @returns {string|null}
   */
  get videoCodec() {
    return this.#videoCodec || null;
  }

  /**
   * @readonly
   * @property {string|null} mime
   * - Returns the mime type information as a <b>string</b>.
   * <br/>
   * - Returns <b>null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
   * @returns {string|null}
   */
  get mime() {
    return this.#mime || null;
  }

  /**
   * @readonly
   * @property {number} timescale
   * - Returns the timescale information as a <b>number</b>.
   * <br/>
   * - Returns <b>-1</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
   * @returns {number}
   */
  get timescale() {
    return this.#timescale || -1;
  }

  /**
   * @readonly
   * @property {Buffer|null} initialization
   * - Returns the Mp4 initialization fragment as a <b>Buffer</b>.
   * <br/>
   * - Returns <b>null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
   * @returns {Buffer|null}
   */
  get initialization() {
    return this.#initialization || null;
  }

  /**
   * @readonly
   * @property {number} poolLength
   * - Returns the number of array buffers in pool
   * <br/>
   * - Returns <b>-1</b> if pool not in use.
   * @returns {number}
   */
  get poolLength() {
    return this.#poolLength || -1;
  }

  /**
   * @readonly
   * @property {Buffer|null} segment
   * - Returns the latest Mp4 segment as a <b>Buffer</b>.
   * <br/>
   * - Returns <b>null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {Buffer|null}
   */
  get segment() {
    return this.#segment || null;
  }

  /**
   * @readonly
   * @property {object} segmentObject
   * - Returns the latest Mp4 segment as an <b>object</b>.
   * <br/>
   *  - <b><code>{segment, sequence, duration, timestamp, keyframe}</code></b>
   * <br/>
   * - Returns <b>{segment: null, sequence: -1, duration: -1; timestamp: -1, keyframe: true}</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {object}
   */
  get segmentObject() {
    return {
      segment: this.segment,
      sequence: this.sequence,
      duration: this.duration,
      timestamp: this.timestamp,
      keyframe: this.keyframe,
    };
  }

  /**
   * @readonly
   * @property {number} timestamp
   * - Returns the timestamp of the latest Mp4 segment as an <b>Integer</b>(<i>milliseconds</i>).
   * <br/>
   * - Returns <b>-1</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {number}
   */
  get timestamp() {
    return this.#timestamp || -1;
  }

  /**
   * @readonly
   * @property {number} duration
   * - Returns the duration of latest Mp4 segment as a <b>Float</b>(<i>seconds</i>).
   * <br/>
   * - Returns <b>-1</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {number}
   */
  get duration() {
    return this.#duration || -1;
  }

  /**
   * @readonly
   * @property {number} totalDuration
   * - Returns the total duration of all Mp4 segments as a <b>Float</b>(<i>seconds</i>).
   * <br/>
   * - Returns <b>-1</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {number}
   */
  get totalDuration() {
    return this.#totalDuration || -1;
  }

  /**
   * @readonly
   * @property {number} totalByteLength
   * - Returns the total byte length of the Mp4 initialization and all Mp4 segments as an <b>Integer</b>(<i>bytes</i>).
   * <br/>
   * - Returns <b>-1</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
   * @returns {number}
   */
  get totalByteLength() {
    return this.#totalByteLength || -1;
  }

  /**
   * @readonly
   * @property {string|null} m3u8
   * - Returns the fmp4 HLS m3u8 playlist as a <b>string</b>.
   * <br/>
   * - Returns <b>null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
   * @returns {string|null}
   */
  get m3u8() {
    return this.#m3u8 || null;
  }

  /**
   * @readonly
   * @property {number} sequence
   * - Returns the sequence of the latest Mp4 segment as an <b>Integer</b>.
   * <br/>
   * - Returns <b>-1</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {number}
   */
  get sequence() {
    return Number.isInteger(this.#sequence) ? this.#sequence : -1;
  }

  /**
   * @readonly
   * @property {boolean} keyframe
   * - Returns a boolean indicating if the current segment contains a keyframe.
   * <br/>
   * - Returns <b>false</b> if the current segment does not contain a keyframe.
   * <br/>
   * - Returns <b>true</b> if segment only contains audio.
   * @returns {boolean}
   */
  get keyframe() {
    return typeof this.#keyframe === 'boolean' ? this.#keyframe : true;
  }

  /**
   * @readonly
   * @property {boolean} allKeyframes
   * - Returns a boolean indicating if all segments contain a keyframe.
   * <br/>
   * - Returns <b>false</b> if any segments do not contain a keyframe.
   * @returns {boolean}
   */
  get allKeyframes() {
    return typeof this.#allKeyframes === 'boolean' ? this.#allKeyframes : true;
  }

  /**
   * @readonly
   * @property {Array|null} segmentObjects
   * - Returns the Mp4 segments as an <b>Array</b> of <b>objects</b>
   * <br/>
   * - <b><code>[{segment, sequence, duration, timestamp, keyframe},...]</code></b>
   * <br/>
   * - Returns <b>null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
   * @returns {Array|null}
   */
  get segmentObjects() {
    return this.#segmentObjects && this.#segmentObjects.length ? this.#segmentObjects : null;
  }

  /**
   * @param {number|string} sequence - sequence number
   * - Returns the Mp4 segment that corresponds to the numbered sequence as an <b>object</b>.
   * <br/>
   * - <b><code>{segment, sequence, duration, timestamp, keyframe}</code></b>
   * <br/>
   * - Returns <b>null</b> if there is no segment that corresponds to sequence number.
   * @returns {object|null}
   */
  getSegmentObject(sequence) {
    sequence = Number.parseInt(sequence);
    if (this.#segmentObjects && this.#segmentObjects.length) {
      return this.#segmentObjects[this.#segmentObjects.length - 1 - (this.#sequence - sequence)] || null;
    }
    return null;
  }

  /**
   * Clear cached values
   */
  resetCache() {
    /*
    todo after version 0.7.0
    deprecate
    */
    this.reset();
  }

  /**
   * Clear cached values
   */
  reset() {
    this.emit('reset');
    this.#parseChunk = this.#findFtyp;
    if (this.#segmentObjects) {
      this.#segmentObjects = [];
    }
    this.#timescale = undefined;
    this.#sequence = undefined;
    this.#allKeyframes = undefined;
    this.#keyframe = undefined;
    this.#mime = undefined;
    this.#videoCodec = undefined;
    this.#audioCodec = undefined;
    this.#initialization = undefined;
    this.#segment = undefined;
    this.#timestamp = undefined;
    this.#duration = undefined;
    this.#totalDuration = undefined;
    this.#totalByteLength = undefined;
    this.#m3u8 = undefined;
    this.#setKeyframe = this.#noop;
    this.#resetFtypMoov();
    this.#resetMoofMdat();
    if (this.#bufferPool) {
      this.#bufferPool.reset();
    }
  }

  /**
   *
   * @returns {object}
   */
  toJSON() {
    return {
      initialization: this.initialization,
      audioCodec: this.audioCodec,
      videoCodec: this.videoCodec,
      mime: this.mime,
      timescale: this.timescale,
      poolLength: this.poolLength,
      segmentObject: this.segmentObject,
      segmentObjects: this.segmentObjects,
      totalDuration: this.totalDuration,
      totalByteLength: this.totalByteLength,
      allKeyframes: this.allKeyframes,
      m3u8: this.m3u8,
    };
  }

  /**
   * @private
   */
  #noop() {}

  /**
   *
   * @param {string} msg
   * @param {string} code
   * @private
   */
  #emitError(msg, code) {
    this.#parseChunk = this.#noop;
    const error = new Error(msg);
    error.code = code;
    this.emit('error', error);
  }

  /**
   * Search buffer for ftyp.
   * @param {Buffer} chunk
   * @private
   */
  #findFtyp(chunk) {
    const chunkLength = chunk.length;
    if (chunk.indexOf(Mp4Frag.#FTYP) === 4) {
      this.#ftypSize = chunk.readUInt32BE(0);
      if (this.#ftypSize === chunkLength) {
        this.#ftypMoovChunks.push(chunk);
        this.#ftypMoovChunksTotalLength += chunkLength;
        this.#parseChunk = this.#findMoov;
      } else if (this.#ftypSize < chunkLength) {
        // recursive
        this.#ftypMoovChunks.push(chunk.subarray(0, this.#ftypSize));
        this.#ftypMoovChunksTotalLength += this.#ftypSize;
        const nextChunk = chunk.subarray(this.#ftypSize);
        this.#parseChunk = this.#findMoov;
        this.#parseChunk(nextChunk);
      } else {
        this.#emitError(`ftypSize:${this.#ftypSize} > chunkLength:${chunkLength}.`, Mp4Frag.#ERR.chunkLength);
      }
    } else {
      this.#emitError(`${Mp4Frag.#FTYP.toString()} not found. chunkLength:${chunkLength}.`, Mp4Frag.#ERR.chunkParse);
    }
  }

  /**
   * Search buffer for moov.
   * @param {Buffer} chunk
   * @private
   */
  #findMoov(chunk) {
    const chunkLength = chunk.length;
    if (chunk.indexOf(Mp4Frag.#MOOV) === 4) {
      this.#moovSize = chunk.readUInt32BE(0);
      this.#ftypMoovSize = this.#ftypSize + this.#moovSize;
      if (this.#moovSize === chunkLength) {
        this.#ftypMoovChunks.push(chunk);
        this.#ftypMoovChunksTotalLength += chunkLength;
        this.#handleFtypMoov();
        this.#parseChunk = this.#findMoof;
      } else if (this.#moovSize < chunkLength) {
        // recursive
        this.#ftypMoovChunks.push(chunk.subarray(0, this.#moovSize));
        this.#ftypMoovChunksTotalLength += this.#moovSize;
        const nextChunk = chunk.subarray(this.#moovSize);
        this.#handleFtypMoov();
        this.#parseChunk = this.#findMoof;
        this.#parseChunk(nextChunk);
      } else {
        this.#emitError(`moovSize:${this.#moovSize} > chunkLength:${chunkLength}.`, Mp4Frag.#ERR.chunkLength);
      }
    } else {
      this.#emitError(`${Mp4Frag.#MOOV.toString()} not found. chunkLength:${chunkLength}.`, Mp4Frag.#ERR.chunkParse);
    }
  }

  #resetFtypMoov() {
    this.#ftypSize = this.#moovSize = this.#ftypMoovSize = this.#ftypMoovChunks.length = this.#ftypMoovChunksTotalLength = 0;
  }

  #handleFtypMoov() {
    const ftypMoov = ((list, totalLength) => {
      if (list.length === 2) {
        const [ftyp, moov] = list;
        if (ftyp.buffer === moov.buffer && ftyp.buffer.byteLength === totalLength) {
          return Buffer.from(ftyp.buffer);
        }
      }
      let bytesCopied = 0;
      const buffer = Buffer.allocUnsafeSlow(totalLength);
      list.forEach(chunk => {
        bytesCopied += chunk.copy(buffer, bytesCopied);
      });
      return buffer;
    })(this.#ftypMoovChunks, this.#ftypMoovChunksTotalLength);
    this.#resetFtypMoov();
    this.#initialize(ftypMoov);
  }

  /**
   * Search buffer for moof.
   * @param {Buffer} chunk
   * @private
   */
  #findMoof(chunk) {
    const chunkLength = chunk.length;
    if (this.#moofSize) {
      if (this.#moofSize === this.#moofMdatChunksTotalLength + chunkLength) {
        this.#moofMdatChunks.push(chunk);
        this.#moofMdatChunksTotalLength += chunkLength;
        this.#parseChunk = this.#findMdat;
      } else if (this.#moofSize < this.#moofMdatChunksTotalLength + chunkLength) {
        // recursive
        const finalChunkSize = this.#moofSize - this.#moofMdatChunksTotalLength;
        this.#moofMdatChunks.push(chunk.subarray(0, finalChunkSize));
        this.#moofMdatChunksTotalLength += finalChunkSize;
        const nextChunk = chunk.subarray(finalChunkSize);
        this.#parseChunk = this.#findMdat;
        this.#parseChunk(nextChunk);
      } else {
        this.#moofMdatChunks.push(chunk);
        this.#moofMdatChunksTotalLength += chunkLength;
      }
    } else {
      if (chunk.indexOf(Mp4Frag.#MOOF) === 4) {
        this.#moofSize = chunk.readUInt32BE(0);
        if (this.#moofSize === chunkLength) {
          this.#moofMdatChunks.push(chunk);
          this.#moofMdatChunksTotalLength += chunkLength;
          this.#parseChunk = this.#findMdat;
        } else if (this.#moofSize < chunkLength) {
          // recursive
          this.#moofMdatChunks.push(chunk.subarray(0, this.#moofSize));
          this.#moofMdatChunksTotalLength += this.#moofSize;
          const nextChunk = chunk.subarray(this.#moofSize);
          this.#parseChunk = this.#findMdat;
          this.#parseChunk(nextChunk);
        } else {
          this.#moofMdatChunks.push(chunk);
          this.#moofMdatChunksTotalLength += chunkLength;
        }
      } else {
        if (chunk.indexOf(Mp4Frag.#MFRA) === 4) {
          // console.log(`\nend of segments ${Mp4Frag.#MFRA.toString()}\n`);
          this.#parseChunk = this.#noop;
        } else {
          if (this.#smallChunk) {
            // recursive
            const repairedChunk = Buffer.concat([this.#smallChunk, chunk]);
            this.#smallChunk = undefined;
            this.#parseChunk(repairedChunk);
          } else if (chunkLength < 8) {
            this.#smallChunk = chunk;
          } else {
            this.#emitError(`${Mp4Frag.#MOOF.toString()} not found. chunkLength:${chunkLength}.`, Mp4Frag.#ERR.chunkParse);
          }
        }
      }
    }
  }

  /**
   * Search buffer for mdat.
   * @param {Buffer} chunk
   * @private
   */
  #findMdat(chunk) {
    const chunkLength = chunk.length;
    if (this.#mdatSize) {
      if (this.#moofMdatSize === this.#moofMdatChunksTotalLength + chunkLength) {
        this.#moofMdatChunks.push(chunk);
        this.#moofMdatChunksTotalLength += chunkLength;
        this.#handleMoofMdat();
        this.#parseChunk = this.#findMoof;
      } else if (this.#moofMdatSize < this.#moofMdatChunksTotalLength + chunkLength) {
        // recursive
        const finalChunkSize = this.#moofMdatSize - this.#moofMdatChunksTotalLength;
        this.#moofMdatChunks.push(chunk.subarray(0, finalChunkSize));
        this.#moofMdatChunksTotalLength += finalChunkSize;
        const nextChunk = chunk.subarray(finalChunkSize);
        this.#handleMoofMdat();
        this.#parseChunk = this.#findMoof;
        this.#parseChunk(nextChunk);
      } else {
        this.#moofMdatChunks.push(chunk);
        this.#moofMdatChunksTotalLength += chunkLength;
      }
    } else {
      if (chunk.indexOf(Mp4Frag.#MDAT) === 4) {
        this.#mdatSize = chunk.readUInt32BE(0);
        this.#moofMdatSize = this.#moofSize + this.#mdatSize;
        if (this.#mdatSize === chunkLength) {
          this.#moofMdatChunks.push(chunk);
          this.#moofMdatChunksTotalLength += chunkLength;
          this.#handleMoofMdat();
          this.#parseChunk = this.#findMoof;
        } else if (this.#mdatSize < chunkLength) {
          // recursive
          this.#moofMdatChunks.push(chunk.subarray(0, this.#mdatSize));
          this.#moofMdatChunksTotalLength += this.#mdatSize;
          const nextChunk = chunk.subarray(this.#mdatSize);
          this.#handleMoofMdat();
          this.#parseChunk = this.#findMoof;
          this.#parseChunk(nextChunk);
        } else {
          this.#moofMdatChunks.push(chunk);
          this.#moofMdatChunksTotalLength += chunkLength;
        }
      } else {
        if (this.#smallChunk) {
          const repairedChunk = Buffer.concat([this.#smallChunk, chunk]);
          this.#smallChunk = undefined;
          this.#parseChunk(repairedChunk);
        } else if (chunkLength < 8) {
          this.#smallChunk = chunk;
        } else {
          this.#emitError(`${Mp4Frag.#MDAT.toString()} not found. chunkLength:${chunkLength}.`, Mp4Frag.#ERR.chunkParse);
        }
      }
    }
  }

  #resetMoofMdat() {
    this.#moofSize = this.#mdatSize = this.#moofMdatSize = this.#moofMdatChunks.length = this.#moofMdatChunksTotalLength = 0;
  }

  #handleMoofMdat() {
    const moofMdat = ((list, totalLength) => {
      if (list.length === 2) {
        const [moof, mdat] = list;
        if (moof.buffer === mdat.buffer && moof.byteOffset + moof.length === mdat.byteOffset) {
          return Buffer.from(moof.buffer, moof.byteOffset, totalLength);
        }
      }
      return this.#bufferConcat(list, totalLength);
    })(this.#moofMdatChunks, this.#moofMdatChunksTotalLength);
    this.#resetMoofMdat();
    this.#setSegment(moofMdat);
  }

  /**
   * Parse moov for mime.
   * @fires Mp4Frag#initialized
   * @param {Buffer} chunk
   * @private
   */
  #initialize(chunk) {
    this.#initialization = chunk;
    const mdhdIndex = chunk.indexOf(Mp4Frag.#MDHD);
    const mdhdVersion = chunk[mdhdIndex + 4];
    this.#timescale = chunk.readUInt32BE(mdhdIndex + (mdhdVersion === 0 ? 16 : 24));
    this.#timestamp = Date.now();
    this.#sequence = -1;
    this.#allKeyframes = true;
    this.#totalDuration = 0;
    this.#totalByteLength = chunk.byteLength;
    const codecs = [];
    let mp4Type;
    if (this.#parseCodecAVCC(chunk) || this.#parseCodecHVCC(chunk)) {
      codecs.push(this.#videoCodec);
      mp4Type = 'video';
    }
    if (this.#parseCodecMP4A(chunk)) {
      codecs.push(this.#audioCodec);
      if (!this.#videoCodec) {
        mp4Type = 'audio';
      }
    }
    if (codecs.length === 0) {
      this.#emitError('codecs not found.', Mp4Frag.#ERR.chunkParse);
      return;
    }
    this.#mime = `${mp4Type}/mp4; codecs="${codecs.join(', ')}"`;
    if (this.#hlsPlaylist && this.#hlsPlaylist.init) {
      let m3u8 = '#EXTM3U\n';
      m3u8 += '#EXT-X-VERSION:7\n';
      m3u8 += `#EXT-X-TARGETDURATION:1\n`;
      m3u8 += `#EXT-X-MEDIA-SEQUENCE:0\n`;
      m3u8 += `#EXT-X-MAP:URI="init-${this.#hlsPlaylist.base}.mp4"\n`;
      this.#m3u8 = m3u8;
    }
    this.#sendInit();
    /*
    todo after version 0.7.0
    replace with emit('data')
    */
    this.emit('initialized', { mime: this.mime, initialization: this.initialization, m3u8: this.m3u8 });
  }

  /**
   * @private
   */
  #sendInitAsBuffer() {
    this.emit('data', this.initialization, { type: 'init', mime: this.mime, m3u8: this.m3u8 });
  }

  /**
   * @private
   */
  #sendInitAsObject() {
    this.emit('data', { type: 'init', initialization: this.initialization, mime: this.mime, m3u8: this.m3u8 });
  }

  /**
   * Set hvcC keyframe.
   * @param {Buffer} chunk
   * @private
   */
  #setKeyframeHVCC(chunk) {
    // let index = this.#moofSize + 8;
    let index = chunk.indexOf(Mp4Frag.#MDAT) + 4;
    const end = chunk.length - 5;
    while (index < end) {
      const nalLength = chunk.readUInt32BE(index);
      // simplify check for iframe nal types 16, 17, 18, 19, 20, 21; (chunk[(index += 4)] & 0x20) >> 1
      if ((chunk[(index += 4)] & 0x20) === 32) {
        this.#keyframe = true;
        return;
      }
      index += nalLength;
    }
    this.#allKeyframes = false;
    this.#keyframe = false;
  }

  /**
   * Set avcC keyframe.
   * @see {@link https://github.com/video-dev/hls.js/blob/729a36d409cc78cc391b17a0680eaf743f9213fb/tools/mp4-inspect.js#L48}
   * @param {Buffer} chunk
   * @private
   */
  #setKeyframeAVCC(chunk) {
    // let index = this.#moofSize + 8;
    let index = chunk.indexOf(Mp4Frag.#MDAT) + 4;
    const end = chunk.length - 5;
    while (index < end) {
      const nalLength = chunk.readUInt32BE(index);
      if ((chunk[(index += 4)] & 0x1f) === 5) {
        this.#keyframe = true;
        return;
      }
      index += nalLength;
    }
    this.#allKeyframes = false;
    this.#keyframe = false;
  }

  /**
   * Get duration of segment.
   * @see {@link https://github.com/video-dev/hls.js/blob/04cc5f167dac2aed4e41e493125968838cb32445/src/utils/mp4-tools.ts#L392}
   * @param {Buffer} chunk
   * @private
   */
  #parseDuration(chunk) {
    const trunIndex = chunk.indexOf(Mp4Frag.#TRUN);
    let trunOffset = trunIndex + 4;
    const trunFlags = chunk.readUInt32BE(trunOffset);
    trunOffset += 4;
    const sampleCount = chunk.readUInt32BE(trunOffset);
    // prefer using trun sample durations
    if (trunFlags & 0x000100) {
      trunOffset += 4;
      trunFlags & 0x000001 && (trunOffset += 4);
      trunFlags & 0x000004 && (trunOffset += 4);
      const increment = 4 + (trunFlags & 0x000200 && 4) + (trunFlags & 0x000400 && 4) + (trunFlags & 0x000800 && 4);
      let sampleDurationSum = 0;
      for (let i = 0; i < sampleCount; ++i, trunOffset += increment) {
        sampleDurationSum += chunk.readUInt32BE(trunOffset);
      }
      return sampleDurationSum / this.#timescale;
    }
    // fallback to using tfhd default sample duration
    const tfhdIndex = chunk.indexOf(Mp4Frag.#TFHD);
    let tfhdOffset = tfhdIndex + 4;
    const tfhdFlags = chunk.readUInt32BE(tfhdOffset);
    if (tfhdFlags & 0x000008) {
      tfhdOffset += 8;
      tfhdFlags & 0x000001 && (tfhdOffset += 8);
      tfhdFlags & 0x000002 && (tfhdOffset += 4);
      return (chunk.readUInt32BE(tfhdOffset) * sampleCount) / this.#timescale;
    }
    return 0;
  }

  /**
   * Set duration and timestamp.
   * @param {Buffer} chunk
   * @private
   */
  #setDurTime(chunk) {
    const duration = this.#parseDuration(chunk);
    const currentTime = Date.now();
    this.#duration = duration || (currentTime - this.#timestamp) / 1000;
    this.#timestamp = currentTime;
  }

  /**
   * Process current segment.
   * @fires Mp4Frag#segment
   * @param {Buffer} chunk
   * @private
   */
  #setSegment(chunk) {
    this.#segment = chunk;
    this.#setKeyframe(chunk);
    this.#setDurTime(chunk);
    this.#sequence++;
    if (this.#segmentObjects) {
      this.#segmentObjects.push({
        segment: chunk,
        sequence: this.#sequence,
        duration: this.#duration,
        timestamp: this.#timestamp,
        keyframe: this.#keyframe,
      });
      this.#totalDuration += this.#duration;
      this.#totalByteLength += chunk.byteLength;
      while (this.#segmentObjects.length > this.#segmentCount) {
        const {
          duration,
          segment: { byteLength },
        } = this.#segmentObjects.shift();
        this.#totalDuration -= duration;
        this.#totalByteLength -= byteLength;
      }
      if (this.#hlsPlaylist) {
        let i = this.#segmentObjects.length > this.#hlsPlaylist.size ? this.#segmentObjects.length - this.#hlsPlaylist.size : 0;
        const mediaSequence = this.#segmentObjects[i].sequence;
        let targetDuration = 1;
        let segments = '';
        for (i; i < this.#segmentObjects.length; ++i) {
          targetDuration = Math.max(targetDuration, this.#segmentObjects[i].duration);
          segments += `#EXTINF:${this.#segmentObjects[i].duration.toFixed(6)},\n`;
          segments += `${this.#hlsPlaylist.base}${this.#segmentObjects[i].sequence}.m4s\n`;
        }
        let m3u8 = '#EXTM3U\n';
        m3u8 += '#EXT-X-VERSION:7\n';
        m3u8 += `#EXT-X-TARGETDURATION:${Math.round(targetDuration) || 1}\n`;
        m3u8 += `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}\n`;
        m3u8 += `#EXT-X-MAP:URI="init-${this.#hlsPlaylist.base}.mp4"\n`;
        m3u8 += segments;
        this.#m3u8 = m3u8;
      }
    } else {
      this.#totalDuration = this.#duration;
      this.#totalByteLength = this.#initialization.byteLength + chunk.byteLength;
    }
    this.#sendSegment();
    /*
    todo after version 0.7.0
    replace with emit('data')
    */
    this.emit('segment', this.segmentObject);
  }

  /**
   * @private
   */
  #sendSegmentAsBuffer() {
    this.emit('data', this.segment, { type: 'segment', sequence: this.sequence, duration: this.duration, timestamp: this.timestamp, keyframe: this.keyframe });
  }

  /**
   * @private
   */
  #sendSegmentAsObject() {
    this.emit('data', { type: 'segment', segment: this.segment, sequence: this.sequence, duration: this.duration, timestamp: this.timestamp, keyframe: this.keyframe });
  }

  /**
   * @param {Buffer} chunk
   * @returns {boolean}
   * @private
   */
  #parseCodecMP4A(chunk) {
    const index = chunk.indexOf(Mp4Frag.#MP4A);
    if (index !== -1) {
      const codec = ['mp4a'];
      const esdsIndex = chunk.indexOf(Mp4Frag.#ESDS, index);
      // verify tags 3, 4, 5 to be in expected positions
      if (esdsIndex !== -1 && chunk[esdsIndex + 8] === 0x03 && chunk[esdsIndex + 16] === 0x04 && chunk[esdsIndex + 34] === 0x05) {
        codec.push(chunk[esdsIndex + 21].toString(16));
        codec.push(((chunk[esdsIndex + 39] & 0xf8) >> 3).toString());
        this.#audioCodec = codec.join('.');
        return true;
      }
      // console.warn('unexpected mp4a esds structure');
    }
    return false;
  }

  /**
   * @param {Buffer} chunk
   * @returns {boolean}
   * @private
   */
  #parseCodecAVCC(chunk) {
    const index = chunk.indexOf(Mp4Frag.#AVCC);
    if (index !== -1) {
      const codec = [];
      if (chunk.includes(Mp4Frag.#AVC1)) {
        codec.push('avc1');
      } else if (chunk.includes(Mp4Frag.#AVC2)) {
        codec.push('avc2');
      } else if (chunk.includes(Mp4Frag.#AVC3)) {
        codec.push('avc3');
      } else if (chunk.includes(Mp4Frag.#AVC4)) {
        codec.push('avc4');
      } else {
        return false;
      }
      codec.push(
        chunk
          .subarray(index + 5, index + 8)
          .toString('hex')
          .toUpperCase()
      );
      this.#videoCodec = codec.join('.');
      this.#setKeyframe = this.#setKeyframeAVCC;
      return true;
    }
    return false;
  }

  /**
   * @param {Buffer} chunk
   * @returns {boolean}
   * @private
   */
  #parseCodecHVCC(chunk) {
    const index = chunk.indexOf(Mp4Frag.#HVCC);
    if (index !== -1) {
      const codec = [];
      if (chunk.includes(Mp4Frag.#HVC1)) {
        codec.push('hvc1');
      } else if (chunk.includes(Mp4Frag.#HEV1)) {
        codec.push('hev1');
      } else {
        return false;
      }
      const tmpByte = chunk[index + 5];
      const generalProfileSpace = tmpByte >> 6; // get 1st 2 bits (11000000)
      const generalTierFlag = !!(tmpByte & 0x20) ? 'H' : 'L'; // get next bit (00100000)
      const generalProfileIdc = (tmpByte & 0x1f).toString(); // get last 5 bits (00011111)
      const generalProfileCompatibility = Mp4Frag.#reverseBitsToHex(chunk.readUInt32BE(index + 6));
      const generalConstraintIndicator = Buffer.from(chunk.subarray(index + 10, index + 16).filter(byte => !!byte)).toString('hex');
      const generalLevelIdc = chunk[index + 16].toString();
      switch (generalProfileSpace) {
        case 0:
          codec.push(generalProfileIdc);
          break;
        case 1:
          codec.push(`A${generalProfileIdc}`);
          break;
        case 2:
          codec.push(`B${generalProfileIdc}`);
          break;
        case 3:
          codec.push(`C${generalProfileIdc}`);
          break;
      }
      codec.push(generalProfileCompatibility);
      codec.push(`${generalTierFlag}${generalLevelIdc}`);
      if (generalConstraintIndicator.length) {
        codec.push(generalConstraintIndicator);
      }
      this.#videoCodec = codec.join('.');
      this.#setKeyframe = this.#setKeyframeHVCC;
      return true;
    }
    return false;
  }

  /**
   * Required for stream transform.
   * @param {Buffer} chunk
   * @param {string} encoding
   * @param {TransformCallback} callback
   * @private
   */
  _transform(chunk, encoding, callback) {
    this.#parseChunk(chunk);
    callback();
  }

  /**
   * Run cleanup when unpiped.
   * @param {TransformCallback} callback
   * @private
   */
  _flush(callback) {
    this.reset();
    callback();
  }

  /**
   * Validate number is in range.
   * @param {number|string} n
   * @param {number} def
   * @param {number} min
   * @param {number} max
   * @returns {number}
   * @private
   * @static
   */
  static #validateInt(n, def, min, max) {
    n = Number.parseInt(n);
    return isNaN(n) ? def : n < min ? min : n > max ? max : n;
  }

  /**
   * Validate boolean value.
   * @param {*} bool
   * @param {boolean} def
   * @returns {boolean}
   * @private
   * @static
   */
  static #validateBool(bool, def) {
    return typeof bool === 'boolean' ? bool : def;
  }

  /**
   * Reverse bits and convert to hexadecimal.
   * @see {@link http://graphics.stanford.edu/~seander/bithacks.html#ReverseParallel}
   * @param {number} n - unsigned 32-bit integer
   * @returns {string} - bit reversed hex string
   * @private
   * @static
   */
  static #reverseBitsToHex(n) {
    n = ((n >> 1) & 0x55555555) | ((n & 0x55555555) << 1);
    n = ((n >> 2) & 0x33333333) | ((n & 0x33333333) << 2);
    n = ((n >> 4) & 0x0f0f0f0f) | ((n & 0x0f0f0f0f) << 4);
    n = ((n >> 8) & 0x00ff00ff) | ((n & 0x00ff00ff) << 8);
    return ((n >> 16) | (n << 16)).toString(16);
  }

  /**
   * Create box Buffer.
   * @param {number[]} arr
   * @returns {Buffer}
   * @private
   * @static
   */
  static #boxFrom(arr) {
    const buffer = Buffer.allocUnsafeSlow(4);
    for (let i = 0; i < 4; ++i) {
      buffer[i] = arr[i];
    }
    return buffer;
  }
}

/**
 * Fires when the [initialization]{@link Mp4Frag#initialization} of the Mp4 is parsed from the piped data.
 * @event Mp4Frag#initialized
 * @type {Event}
 * @property {object} object
 * @property {string} object.mime - [Mp4Frag.mime]{@link Mp4Frag#mime}
 * @property {Buffer} object.initialization - [Mp4Frag.initialization]{@link Mp4Frag#initialization}
 * @property {string} object.m3u8 - [Mp4Frag.m3u8]{@link Mp4Frag#m3u8}
 */

/**
 * Fires when the latest Mp4 segment is parsed from the piped data.
 * @event Mp4Frag#segment
 * @type {Event}
 * @property {object} object - [Mp4Frag.segmentObject]{@link Mp4Frag#segmentObject}
 * @property {Buffer} object.segment - [Mp4Frag.segment]{@link Mp4Frag#segment}
 * @property {number} object.sequence - [Mp4Frag.sequence]{@link Mp4Frag#sequence}
 * @property {number} object.duration - [Mp4Frag.duration]{@link Mp4Frag#duration}
 * @property {number} object.timestamp - [Mp4Frag.timestamp]{@link Mp4Frag#timestamp}
 * @property {number} object.keyframe - [Mp4Frag.keyframe]{@link Mp4Frag#keyframe}
 */

/**
 * Fires when reset() is called.
 * @event Mp4Frag#reset
 * @type {Event}
 */

module.exports = Mp4Frag;
