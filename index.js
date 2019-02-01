'use strict';

const { Transform } = require('stream');

const _FTYP = Buffer.from([0x66, 0x74, 0x79, 0x70]);// ftyp
const _MOOV = Buffer.from([0x6D, 0x6F, 0x6F, 0x76]);// moov
const _MOOF = Buffer.from([0x6D, 0x6F, 0x6F, 0x66]);// moof
const _MFRA = Buffer.from([0x6d, 0x66, 0x72, 0x61]);// mfra
const _MDAT = Buffer.from([0x6D, 0x64, 0x61, 0x74]);// mdat
const _MP4A = Buffer.from([0x6d, 0x70, 0x34, 0x61]);// mp4a
const _AVCC = Buffer.from([0x61, 0x76, 0x63, 0x43]);// avcC

/**
 * @fileOverview Creates a stream transform for piping a fmp4 (fragmented mp4) from ffmpeg.
 * Can be used to generate a fmp4 m3u8 HLS playlist and compatible file fragments.
 * Can also be used for storing past segments of the mp4 video in a buffer for later access.
 * Must use the following ffmpeg flags <b><i>-movflags +frag_keyframe+empty_moov</i></b> to generate a fmp4
 * with a compatible file structure : ftyp+moov -> moof+mdat -> moof+mdat -> moof+mdat ...
 * @requires stream.Transform
 */
class Mp4Frag extends Transform {
    /**
     * @constructor
     * @param {Object} [options] - Configuration options.
     * @param {String} [options.hlsBase] - Base name of files in fmp4 m3u8 playlist. Affects the generated m3u8 playlist by naming file fragments. Must be set to generate m3u8 playlist.
     * @param {Number} [options.hlsListSize] - Number of segments to keep in fmp4 m3u8 playlist. Must be an integer ranging from 2 to 10. Defaults to 4 if hlsBase is set and hlsListSize is not set.
     * @param {Boolean} [options.hlsListInit] - Indicates that m3u8 playlist should be generated after init segment is created and before media segments are created. Defaults to false.
     * @param {Number} [options.bufferListSize] - Number of segments to keep buffered. Must be an integer ranging from 2 to 10. Not related to HLS settings.
     * @param {Function} [callback] - Function to be called when segments are parsed from piped data. Must be able to pass 1 parameter that will contain segment buffer.
     * @returns {Mp4Frag} this - Returns reference to new instance of Mp4Frag for chaining event listeners.
     */
    constructor(options, callback) {
        super(options);
        if (options) {
            if (typeof options.hlsBase === 'string' && /^[a-zA-Z0-9]+$/i.exec(options.hlsBase)) {
                const hlsListSize = parseInt(options.hlsListSize);
                this._hlsListInit = options.hlsListInit === true;
                if (isNaN(hlsListSize)) {
                    this._hlsListSize = 4;
                } else if (hlsListSize < 2) {
                    this._hlsListSize = 2;
                } else if (hlsListSize > 10) {
                    this._hlsListSize = 10;
                } else {
                    this._hlsListSize = hlsListSize;
                }
                this._hlsList = [];
                this._hlsBase = options.hlsBase;
                this._sequence = 0;
            }
            if (options.hasOwnProperty('bufferListSize')) {
                const bufferListSize = parseInt(options.bufferListSize);
                if (isNaN(bufferListSize) || bufferListSize < 2) {
                    this._bufferListSize = 2;
                } else if (bufferListSize > 10) {
                    this._bufferListSize = 10;
                } else {
                    this._bufferListSize = bufferListSize;
                }
                this._bufferList = [];
            }
        }
        if (typeof callback === 'function') {
            this._callback = callback;
        }
        this._parseChunk = this._findFtyp;
        return this;
    }

    /**
     * @readonly
     * @property {String} mime
     * - Returns the mime codec information as a String.
     * <br/>
     * - Returns <b>Null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
     * @returns {String}
     */
    get mime() {
        return this._mime || null;
    }

    /**
     * @readonly
     * @property {Buffer} initialization
     * - Returns the mp4 initialization fragment as a Buffer.
     * <br/>
     * - Returns <b>Null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
     * @returns {Buffer}
     */
    get initialization() {
        return this._initialization || null;
    }

    /**
     * @readonly
     * @property {Buffer} segment
     * - Returns the latest Mp4 segment as a Buffer.
     * <br/>
     * - Returns <b>Null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
     * @returns {Buffer}
     */
    get segment() {
        return this._segment || null;
    }

    /**
     * @readonly
     * @property {Integer} timestamp
     * - Returns the timestamp of the latest Mp4 segment as an Integer(milliseconds).
     * <br/>
     * - Returns <b>-1</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
     * @returns {Integer}
     */
    get timestamp() {
        return this._timestamp || -1;
    }

    /**
     * @readonly
     * @property {Float} duration
     * - Returns the duration of latest Mp4 segment as a Float(seconds).
     * <br/>
     * - Returns <b>-1</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
     * @returns {Float}
     */
    get duration() {
        return this._duration || -1;
    }

    /**
     * @readonly
     * @property {String} m3u8
     * - Returns the fmp4 HLS m3u8 playlist as a String.
     * <br/>
     * - Returns <b>Null</b> if requested before [initialized event]{@link Mp4Frag#event:initialized}.
     * @returns {String}
     */
    get m3u8() {
        return this._m3u8 || null;
    }

    /**
     * @readonly
     * @property {Integer} sequence
     * - Returns the latest sequence of the fmp4 HLS m3u8 playlist as an Integer.
     * <br/>
     * - Returns <b>-1</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
     * @returns {Integer}
     */
    get sequence() {
        return this._sequence || -1;
    }

    /**
     * @readonly
     * @property {Array} bufferList
     * - Returns the buffered mp4 segments as an Array.
     * <br/>
     * - Returns <b>Null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
     * @returns {Array}
     */
    get bufferList() {
        if (this._bufferList && this._bufferList.length > 0) {
            return this._bufferList;
        }
        return null;
    }

    /**
     * @readonly
     * @property {Buffer} bufferListConcat
     * - Returns the [Mp4Frag.bufferList]{@link Mp4Frag#bufferList} concatenated as a Buffer.
     * <br/>
     * - Returns <b>Null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
     * @returns {Buffer}
     */
    get bufferListConcat() {
        if (this._bufferList && this._bufferList.length > 0) {
            return Buffer.concat(this._bufferList);
        }
        return null;
    }

    /**
     * @readonly
     * @property {Buffer} bufferConcat
     * - Returns the [Mp4Frag.initialization]{@link Mp4Frag#initialization} and [Mp4Frag.bufferList]{@link Mp4Frag#bufferList} concatenated as a Buffer.
     * <br/>
     * - Returns <b>Null</b> if requested before first [segment event]{@link Mp4Frag#event:segment}.
     * @returns {Buffer}
     */
    get bufferConcat() {
        if (this._initialization && this._bufferList && this._bufferList.length > 0) {
            return Buffer.concat([this._initialization, ...this._bufferList]);
        }
        return null;
    }

    /**
     * @param {Integer} sequence
     * - Returns the Mp4 segment that corresponds to the HLS sequence number as a Buffer.
     * <br/>
     * - Returns <b>Null</b> if there is no Mp4 segment that corresponds to sequence number.
     * @returns {Buffer}
     */
    getHlsSegment(sequence) {
        if (sequence && this._hlsList && this._hlsList.length > 0) {
            for (let i = 0; i < this._hlsList.length; i++) {
                if (this._hlsList[i].sequence === sequence) {
                    return this._hlsList[i].segment;
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
            this.emit('error', new Error('FTYP not found.'));
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
            this.emit('error', new Error('ftypLength > chunkLength'));
            return;
        }
    }

    /**
     * Search buffer for moov.
     * @private
     */
    _findMoov(chunk) {
        const chunkLength = chunk.length;
        if (chunkLength < 8 || chunk.indexOf(_MOOV) !== 4) {
            this.emit('error', new Error('MOOV not found.'));
            return;
        }
        const moovLength = chunk.readUInt32BE(0, true);
        if (moovLength < chunkLength) {
            this._parseMoov(Buffer.concat([this._ftyp, chunk], (this._ftypLength + moovLength)));
            delete this._ftyp;
            delete this._ftypLength;
            this._parseChunk = this._findMoof;
            this._parseChunk(chunk.slice(moovLength));
        } else if (moovLength === chunkLength) {
            this._parseMoov(Buffer.concat([this._ftyp, chunk], (this._ftypLength + moovLength)));
            delete this._ftyp;
            delete this._ftypLength;
            this._parseChunk = this._findMoof;
        } else {
            //probably should not arrive here here because moov is typically < 800 bytes
            //will have to store chunk until size is big enough to have entire moov piece
            //ffmpeg may have crashed before it could output moov and got us here
            this.emit('error', new Error('moovLength > chunkLength'));
            return;
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
            this.emit('error', new Error('Codec info not found.'));
            return;
        }
        index += 5;
        this._mime = `video/mp4; codecs="avc1.${this._initialization.slice(index, index + 3).toString('hex').toUpperCase()}${audioString}"`;
        this._timestamp = Date.now();
        if (this._hlsList && this._hlsListInit) {
            let m3u8 = '#EXTM3U\n';
            m3u8 += '#EXT-X-VERSION:7\n';
            //m3u8 += '#EXT-X-ALLOW-CACHE:NO\n';
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
        this.emit('initialized', {mime: this._mime, initialization: this._initialization, m3u8: this._m3u8 || null});
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
            this.emit('error', new Error(`MOOF hunt failed after ${this._moofHunts} attempts.`));
            return;
        }
    }

    /**
     * Search buffer for moof.
     * @private
     */
    _findMoof(chunk) {
        if(this._moofBuffer) {
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
                this.emit('error', new Error('Bad data from input stream reports moof length of 0.'));
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
        if (this._hlsList) {
            this._hlsList.push({sequence: String(this._sequence++), segment: this._segment, duration: this._duration});
            while (this._hlsList.length > this._hlsListSize) {
                this._hlsList.shift();
            }
            let m3u8 = '#EXTM3U\n';
            m3u8 += '#EXT-X-VERSION:7\n';
            //m3u8 += '#EXT-X-ALLOW-CACHE:NO\n';
            m3u8 += `#EXT-X-TARGETDURATION:${Math.round(this._duration)}\n`;
            m3u8 += `#EXT-X-MEDIA-SEQUENCE:${this._hlsList[0].sequence}\n`;
            m3u8 += `#EXT-X-MAP:URI="init-${this._hlsBase}.mp4"\n`;
            for (let i = 0; i < this._hlsList.length; i++) {
                m3u8 += `#EXTINF:${this._hlsList[i].duration.toFixed(6)},\n`;
                m3u8 += `${this._hlsBase}${this._hlsList[i].sequence}.m4s\n`;
            }
            this._m3u8 = m3u8;
        }
        if (this._bufferList) {
            this._bufferList.push(this._segment);
            while (this._bufferList.length > this._bufferListSize) {
                this._bufferList.shift();
            }
        }
        if (this._readableState.pipesCount > 0) {
            this.push(this._segment);
        }
        if (this._callback) {
            this._callback(this._segment);
        }
        if (this.listenerCount('segment') > 0) {
            /**
             * Fires when the latest Mp4 segment is parsed from the piped data.
             * @event Mp4Frag#segment
             * @type {Event}
             * @property {Buffer} segment - [Mp4Frag.segment]{@link Mp4Frag#segment}
             */
            this.emit('segment', this._segment);
        }
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
                this._setSegment(Buffer.concat([this._moof, ...this._mdatBuffer], (this._moofLength + this._mdatLength)));
                delete this._moof;
                delete this._mdatBuffer;
                delete this._mdatBufferSize;
                delete this._mdatLength;
                delete this._moofLength;
                this._parseChunk = this._findMoof;
            } else if (this._mdatLength < this._mdatBufferSize) {
                this._setSegment(Buffer.concat([this._moof, ...this._mdatBuffer], (this._moofLength + this._mdatLength)));
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
                this.emit('error', new Error('MDAT not found.'));
                return;
            }
            this._mdatLength = chunk.readUInt32BE(0, true);
            if (this._mdatLength > chunkLength) {
                this._mdatBuffer = [chunk];
                this._mdatBufferSize = chunkLength;
            } else if (this._mdatLength === chunkLength) {
                this._setSegment(Buffer.concat([this._moof, chunk], (this._moofLength + chunkLength)));
                delete this._moof;
                delete this._moofLength;
                delete this._mdatLength;
                this._parseChunk = this._findMoof;
            } else {
                this._setSegment(Buffer.concat([this._moof, chunk], (this._moofLength + this._mdatLength)));
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
        if (this._hlsList) {
            this._hlsList = [];
            this._sequence = 0;
        }
        if (this._bufferList) {
            this._bufferList = [];
        }
    }
}

module.exports = Mp4Frag;
