'use strict';

const profiles = ['baseline', 'main', 'high', 'high10', 'high422', 'high444'];

const levels = ['1b', '10', '11', '12', '13', '20', '21', '22', '30', '31', '32', '40', '41', '42', '50', '51', '52', '60', '61', '62'];

const pixFmts = ['yuv420p', 'yuv422p', 'yuv444p', 'yuv420p10le'];

const keyints = [2, 1];

module.exports = {
  profiles,
  levels,
  pixFmts,
  keyints,
};
