const Mp4Frag = require('../index');

const ffmpegPath = require('../lib/ffmpeg');

const { spawn } = require('child_process');

const { createWriteStream } = require('fs');

const mp4frag = new Mp4Frag({ segmentCount: 10 });

mp4frag.on('initialized', (data) => {
  console.log('---- initialized ----');
  console.log(data);
});

mp4frag.on('segment', (data) => {
  console.log('---- segment ----');
  console.log(data);
});

mp4frag.on('error', (err) => {
  console.error(err);
});

const writeMp4 = () => {
  const { initialization, segmentObjects } = mp4frag;

  if (initialization && segmentObjects) {
    const fileName = `${Date.now()}.mp4`;

    console.log(`creating file ${fileName}`);

    const writeStream = createWriteStream(fileName);

    writeStream.write(initialization);

    segmentObjects.forEach((segmentObject) => {
      const { segment } = segmentObject;

      writeStream.write(segment);
    });

    writeStream.end();
  }
};

// fps = 20 and gop = 10 results in segments with duration 0.5 seconds
const ffmpeg = spawn(ffmpegPath, [
  '-hide_banner',
  '-loglevel',
  'error',
  '-stats',
  //'-re',
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=1280x720:rate=20',
  '-an',
  '-c:v',
  'libx264',
  '-movflags',
  '+frag_keyframe+empty_moov+default_base_moof',
  '-f',
  'mp4',
  '-pix_fmt',
  'yuv420p',
  '-g',
  '10',
  '-profile:v',
  'main',
  '-level',
  '3.1',
  '-crf',
  '25',
  '-metadata',
  'title=test mp4',
  'pipe:1',
]);

ffmpeg.stderr.on('data', (data) => {
  console.log(data.toString());
});

ffmpeg.stdout.pipe(mp4frag);

setTimeout(() => {
  writeMp4();

  ffmpeg.kill();
}, 5000);
