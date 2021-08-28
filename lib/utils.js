const path = require('path');
const util = require('util');
const log = require('./logger');

function isLetter(str) {
  return str.length === 1 && str.match(/[a-z]/i);
}

function isWin() {
  if (/^win/i.test(process.platform)) {
    return true;
  }
  return false;
}

function getCleanPath(argPath) {
  if (!argPath) {
    return '';
  }
  log.debug(`Converting "${argPath}" to standardized path`);
  let normalPath = argPath.split('\\').join(path.posix.sep);

  // const noDriveLetter = normalPath.replace(new RegExp('^[a-zA-Z]:'), '')
  // console.log.debug(noDriveLetter)

  if (!isWin() && normalPath.length > 1 && isLetter(normalPath[0]) && normalPath[1] === ':') {
    // TODO: Assuming wsl path currently. Maybe make this more robust.

    const undrivedPath = normalPath.slice(0, 1) + normalPath.slice(2);
    const wslPath = `/mnt/${undrivedPath.toLowerCase()}`;
    normalPath = wslPath;
  }
  log.debug(`Converted to "${normalPath}"`);
  return normalPath;
}

function getPathData(archivePath) {
  return {
    ext: path.extname(archivePath),
    fileName: path.basename(archivePath, path.extname(archivePath)),
    dir: path.dirname(archivePath),
  };
}

function zeroPad(num, places) {
  return String(num).padStart(places, '0');
}

function inspect(obj) {
  return util.inspect(obj, false, null, true);
}

module.exports = {
  getCleanPath,
  isWin,
  getPathData,
  zeroPad,
  inspect,
};
