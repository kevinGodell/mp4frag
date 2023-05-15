'use strict';

console.time('=====> test10.js');

const { Writable } = require('stream');

const assert = require('assert');

const Mp4Frag = require('../index');

const ffmpegPath = require('../lib/ffmpeg');

const { spawn } = require('child_process');

const count = 1; //expected count of segments

const frames = 1;

const fps = 24; //number of frames per second(same as input video) might not be necessary

const scale = 640; //used as width of video, height will automatically scale

let counter = 0;

const params = [
  '-use_wallclock_as_timestamps',
  '1', // 0|1 will change duration calculations

  /* log info to console */
  '-loglevel',
  'quiet',
  //'-stats',

  /* use hardware acceleration if available */
  '-hwaccel',
  'auto',

  /* use an artificial video input */
  //'-re',
  //'-f', 'lavfi',
  //'-i', 'testsrc=size=1280x720:rate=20',

  '-rtsp_transport',
  'tcp',
  '-i',
  'rtsp://192.168.1.22:554/user=admin_password=pass_channel=1_stream=1.sdp',

  //'-individual_header_trailer', 1,
  //'-write_header_trailer', 0,
  //'-break_non_keyframes', 1,
  //'-map', 0,
  '-an',
  '-c:v',
  'copy',
  '-f',
  'mp4',
  '-movflags',
  //'+empty_moov+negative_cts_offsets',
  //'+empty_moov+omit_tfhd_offset',// 56 = ( 8 + 16 + 32 )
  //'+empty_moov',// 57 = ( 1 + 8 + 16 + 32 )
  //'+empty_moov+default_base_moof+omit_tfhd_offset',// 131128 = ( 8 + 16 + 32 + 131072 )
  //'+dash',// 131128 = ( 8 + 16 + 32 + 131072 )
  //'+frag_keyframe', // 57 = ( 1 + 8 + 16 + 32 )
  '+frag_every_frame',

  '-min_frag_duration',
  '500000',

  //'+empty_moov+default_base_moof',// 131128  = ( 8 + 16 + 32 + 131072 )
  //'-f', 'segment',
  //'-reset_timestamps', 1,
  //'-segment_time', 10,
  //'-segment_atclocktime', 1,
  //'-segment_format', 'mp4',
  //'-segment_format_options', 'movflags=+faststart',
  //'-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof:frag_duration=1000000:min_frag_duration=1000000',
  //'-segment_format_options', 'movflags=+dash+negative_cts_offsets',
  //'-segment_format_options', 'movflags=+dash',
  //'-strftime', 1,
  //'%Y-%m-%dT%H-%M-%S.mp4'
  //'capture=%03d.mp4'
  'pipe:1',

  //-f segment -segment_time 300 -segment_format mp4 "capture-%03d.mp4"

  /*'-rtsp_transport', 'tcp',
    '-i', 'rtsp://131.95.3.162:554/axis-media/media.3gp',*/

  /* set output flags */
  /*'-an',
    '-c:v', 'libx264',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    '-vf', `fps=${fps},scale=${scale}:-1,format=yuv420p`,
    '-frames', frameLimit,
    '-profile:v', 'main',
    '-level', '3.1',
    '-crf', '25',
    '-metadata', 'title=test mp4',
    '-frag_duration', '1000000',//make ffmpeg create segments that are 1 second duration
    '-min_frag_duration', '1000000',//make ffmpeg create segments that are 1 second duration
    'pipe:1'*/
];

const mp4frag = new Mp4Frag({ hlsPlaylistBase: 'test_Name', hlsPlaylistInit: true });

mp4frag.once('initialized', data => {
  console.log('init');
  assert(mp4frag.m3u8 === `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI="init-test_Name.mp4"\n`, 'Unexpected m3u8 data');
});

mp4frag.on('segment', data => {
  console.log('segment duration', data.duration);
  counter++;
});

mp4frag.once('error', data => {
  //error is expected when ffmpeg exits without unpiping
  console.log('mp4frag error', data);
});

const ffmpeg = spawn(ffmpegPath, params, { stdio: ['ignore', 'pipe', 'ignore'] });

ffmpeg.once('error', error => {
  console.log('ffmpeg error', error);
});

ffmpeg.once('exit', (code, signal) => {
  assert(counter === count, `${counter} !== ${count}`);
  assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);
  console.timeEnd('=====> test8.js');
});

ffmpeg.stdio[1].pipe(mp4frag);

const wri = new Writable({
  write(chunk, encoding, callback) {
    //destination(chunk);
    console.log('length', chunk.length, new Date().toISOString());
    //console.log(chunk.length);
    callback();
  },
});

//ffmpeg.stdio[1].pipe(wri);

//-segment_atclocktime 1

//-i rtsp://10.2.2.19/live/ch01_0 -c copy -map 0 -f segment -segment_time 300 -segment_format mp4 "capture-%03d.mp4"
