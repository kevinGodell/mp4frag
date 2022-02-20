'use strict';

const getParams = ({ profile, level, pixFmt, keyint }) => {
  return [
    '-hide_banner',
    '-y',
    '-loglevel',
    'quiet',
    '-nostats',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=qcif:rate=10',
    '-an',
    '-frames:v',
    '1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    `${pixFmt}`,
    '-profile:v',
    `${profile}`,
    '-level:v',
    `${level}`,
    '-x264-params',
    `keyint=${keyint}`,
    '-f',
    'mp4',
    '-movflags',
    '+frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ];
};

module.exports = getParams;
