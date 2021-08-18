const path = require('path');
const fs = require('fs');
const rimraf = require('rimraf');

function log(str, level = 'debug') {
  console.log(`[${level}] ${str}`);
}

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
  let normalPath = argPath.split('\\').join(path.posix.sep);

  // const noDriveLetter = normalPath.replace(new RegExp('^[a-zA-Z]:'), '')
  // console.log(noDriveLetter)

  if (!isWin() && normalPath.length > 1 && isLetter(normalPath[0]) && normalPath[1] === ':') {
    // TODO: Assume wsl path

    const undrivedPath = normalPath.slice(0, 1) + normalPath.slice(2);
    const wslPath = `/mnt/${undrivedPath.toLowerCase()}`;
    normalPath = wslPath;
  }
  return normalPath;
}

function rm(filePath, dryRun = true) {
  log(`Deleting ${filePath}`, 'warn');
  if (!dryRun) {
    rimraf(filePath, () => { log(`Deleted ${filePath}`, 'warn'); });
  }
}

async function checkIsFile(startPath) {
  const stat = await fs.promises.lstat(startPath);
  if (stat.isFile()) {
    return true;
  }
  return false;
}

module.exports = {
  log,
  getCleanPath,
  isWin,
  rm,
  checkIsFile,
};
