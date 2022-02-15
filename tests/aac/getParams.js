'use strict';

const getParams = ({ profile, filename }) => {
  return [
    '-hide_banner',
    '-y',
    '-loglevel',
    'quiet',
    '-nostats',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1:duration=1',
    '-vn',
    '-frames:a',
    '1',
    '-c:a',
    'aac',
    '-profile:a',
    `${profile}`,
    '-f',
    'mp4',
    '-movflags',
    '+frag_keyframe+empty_moov+default_base_moof',
    filename,
  ];
};

module.exports = getParams;
