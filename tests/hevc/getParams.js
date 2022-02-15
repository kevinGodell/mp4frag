'use strict';

const getParams = ({ tag, profile, level, pixFmt, keyint, noHighTier, filename }) => {
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
    'libx265',
    '-pix_fmt',
    `${pixFmt}`,
    '-profile:v',
    `${profile}`,
    '-tag:v',
    `${tag}`,
    '-x265-params',
    `log-level=0:keyint=${keyint}:level-idc=${level}:no-high-tier=${noHighTier}`,
    '-f',
    'mp4',
    '-movflags',
    '+frag_keyframe+empty_moov+default_base_moof',
    filename,
  ];
};

module.exports = getParams;
