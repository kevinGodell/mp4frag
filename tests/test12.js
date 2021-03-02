'use strict';

console.time('=====> test12.js');

const { Writable } = require('stream');

const assert = require('assert');

const Mp4Frag = require('../index');

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const { spawn } = require('child_process');

const count = 1; //expected count of segments

const frames = 1;

const fps = 24; //number of frames per second(same as input video) might not be necessary

const scale = 640; //used as width of video, height will automatically scale

let counter = 0;

const params = [
  /* log info to console */
  //'-loglevel', 'fatal',
  '-stats',

  /* use hardware acceleration if available */
  //'-hwaccel', 'auto',

  '-rtsp_transport',
  'tcp',
  '-i',
  'rtsp://www.infodraw.com:12654/stream/device_6966_camera_1.sdp',

  '-an',
  '-c:v',
  'copy',
  //'-f', 'fifo',
  //'-fifo_format', 'mp4',
  //'-format_opts', 'movflags=+frag_keyframe+isml',
  //'-map', '0:v', '-map', '0:a?',
  '-f',
  'mp4',
  '-movflags',
  '+isml+frag_keyframe',
  'pipe.mp4'
];

const mp4frag = new Mp4Frag({ hlsPlaylistBase: 'test_Name' });

mp4frag.once('initialized', data => {
  console.log('init');
  assert(
    mp4frag.m3u8 ===
      `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI="init-test_Name.mp4"\n`,
    'Unexpected m3u8 data'
  );
});

mp4frag.on('segment', data => {
  console.log('seg');
  counter++;
});

mp4frag.once('error', data => {
  //error is expected when ffmpeg exits without unpiping
  console.log('mp4frag error', data);
});

const ffmpeg = spawn('avconv', params, { stdio: ['ignore', 'pipe', 'inherit'] });

ffmpeg.once('error', error => {
  console.log('ffmpeg error', error);
});

ffmpeg.once('exit', (code, signal) => {
  assert(counter === count, `${counter} !== ${count}`);
  assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);
  console.timeEnd('=====> test12.js');
});

//ffmpeg.stdio[1].pipe(mp4frag);

/*ffmpeg.stdio[1].on('data', (data)=>{
    //if (data.length < 8192) {
    console.log('length', data.length, new Date().toISOString())
    //}
})

const wri = new Writable({
    write(chunk, encoding, callback) {
        //destination(chunk);
        console.log(chunk.length);
        callback();
    }
});*/

ffmpeg.stdio[1].pipe(mp4frag);

//-segment_atclocktime 1

//-i rtsp://10.2.2.19/live/ch01_0 -c copy -map 0 -f segment -segment_time 300 -segment_format mp4 "capture-%03d.mp4"
