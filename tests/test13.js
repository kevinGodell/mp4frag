'use strict';
/* Note:
  * download bento4 from https://www.bento4.com/downloads/
  * uncompress downloaded zip file
  * change  mp4infoPath variable to path where bento4 's mp4info located
*/
console.time('=====> test13.js');

const assert = require('assert');

const Mp4Frag = require('../index');

const ffmpegPath = require('../lib/ffmpeg');

const fs = require('fs');

const { spawn } = require('child_process');



const mp4infoPath = "../bento4/bin/mp4info";

const TMP_DIRECTORY = "./in/";

// profiles: main main10 mainstillpicture msp main - intra main10 - intra main444 - 8 main444 - intra main444 - stillpicture main422 - 10 main422 - 10 - intra main444 - 10 main444 - 10 - intra main12 main12 - intra main422 - 12 main422 - 12 - intra main444 - 12 main444 - 12 - intra main444 - 16 - intra main444 - 16 - stillpicture
const PROFILES = ["main", "main10", "mainstillpicture", "msp", "main-intra", "main10-intra", "main444-8", "main444-intra", "main444-stillpicture", "main422-10", "main422-10-intra", "main444-10", "main444-10-intra", "main12", "main12-intra", "main422-12", "main422-12-intra", "main444-12", "main444-12-intra", "main444-16-intra", "main444-16-stillpicture"];

// levels: 1, 2, 2.1, 3, 3.1, 4, 4.1, 5, 5.1, 5.2, 6, 6.1, 6.2, 8.5
const LEVELS = ["1", "2", "2.1", "3", "3.1", "4", "4.1", "5", "5.1", "5.2", "6", "6.1", "6.2", "8.5"];

const NO_HIGH_TIER = "0" // 0|1, default 0, to allow for automatic high tier if available for profile / level combination

const TAG = "hev1" // hev1|hvc1, default hev1

const getFFmpegParams = (profile, level, filename) => {
  const params = [
    "-y",
    "-loglevel", "quiet",
    "-nostats",
    "-f", "lavfi",
    "-i", "testsrc=size=qcif:rate=10",
    "-an",
    "-c:v", "libx265",
    "-pix_fmt", "yuv420p",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    "-frames", "100",
    "-tag:v", `${TAG}`,
    "-profile:v", `${profile}`,
    "-x265-params", `log-level=0:keyint=10:level-idc="${level}":no-high-tier="${NO_HIGH_TIER}"`,
    filename
  ];

  return params;
}

const parseCodecString = (profile, level) => {
  return new Promise((resolve, reject) => {

    let parsedCodecString;

    let counter = 0;

    const mp4frag = new Mp4Frag();

    mp4frag.once('initialized', (data) => {

      // console.log("data.mime =", data.mime);

      parsedCodecString = data.mime.slice(data.mime.indexOf('"') + 1, data.mime.lastIndexOf('"'));
      
      console.log("codec string parse", parsedCodecString);
    });

    mp4frag.on('segment', (data) => {

      // console.log("mp4frag info: new segment", ++counter);
      //console.log(mp4frag.sequence, data.length, mp4frag.segment.length, mp4frag.getHlsSegment(mp4frag.sequence).length, mp4frag.getHlsNamedSegment(`${hlsBase}${mp4frag.sequence}.m4s`).length);
    });

    mp4frag.once('error', (err) => {
      console.log('mp4frag error', err.message);
    });

    const params = getFFmpegParams(profile, level, "pipe:1");

    const ffmpeg = spawn(ffmpegPath, params, { stdio: ['ignore', 'pipe', 'inherit'] });

    ffmpeg.once('error', (error) => {

      console.log('ffmpeg error', error);

      reject();

    });

    ffmpeg.once('exit', (code, signal) => {

      assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);

      resolve(parsedCodecString);
    });

    ffmpeg.stdio[1].pipe(mp4frag);

  })
}

const getMp4InfoCmd = (filename) => {
  const params = [
    "--fast",
    filename, 
  ];

  return params;
}

const getBenchmarkCodecString = (profile, level) => {
  return new Promise((resolve, reject) => {

    const filename = `${TMP_DIRECTORY}265_${TAG}_${profile}_${level}.mp4`;

    console.log("create filename:", filename);

    const params = getFFmpegParams(profile, level, filename);

    const ffmpeg = spawn(ffmpegPath, params, { stdio: ['ignore', 'pipe', 'inherit'] });

    ffmpeg.once('error', (error) => {

      console.log('ffmpeg error', error);

      reject();

    });

    ffmpeg.once('exit', (code, signal) => {

      assert(code === 0, `FFMPEG exited with code ${code} and signal ${signal}`);

      let result = "";

      const mp4infoParams = getMp4InfoCmd(filename);

      const mp4info = spawn(mp4infoPath, mp4infoParams);

      mp4info.once("error", (error) => {

        console.log('mp4info error', error);

        reject();

      })

      mp4info.once("exit", (code, signal) => {

        assert(code === 0, `MP4INFO exited with code ${code} and signal ${signal}`);

        let strRes = result.toString();

        let parse_str = strRes.match(/Codec String: ([^\n]+)/i)
        
        let codec_string = parse_str[1];

        console.log("benchmark", codec_string);

        fs.unlink(filename, (err) => {// remove generated file
          if (err) {
            console.error("remove file faild: ", filename);

          } else {
            console.log("remove file: ", filename);
          }
          resolve(codec_string);
        }); 

      })

      mp4info.stdout.on("data", (data) => {
        result += data;
      })

    });
  })
}

const compareCodecString = (parsed, benchmark) => {

  // console.log(parsed, benchmark);

  if (parsed === benchmark)
    return true;
  
  if (parsed === benchmark.replace("hev1", "hvc1"))
    return true;
  
  return false;

}

(async () => {
  console.log("Start checking");
  try {
    for (let profile of PROFILES) {
      for (let level of LEVELS) {
        console.log("----------------------------------------------------------------------------------------------------");

        console.log("tag:", TAG, ", profile:", profile, ", level:", level, ", no_high_tier:", NO_HIGH_TIER);

        let parsedCodecString = await parseCodecString(profile, level);

        let benchmarkCodecString = await getBenchmarkCodecString(profile, level);

        assert(compareCodecString(parsedCodecString, benchmarkCodecString) === true, "Something 's wrong");
      }
    }
   

  } catch (e) {

    console.error(e);

  } finally {

    console.timeEnd('=====> test13.js');

  }
})();



