const path = require('path');
const util = require('util');
const os = require('os');
const clone = require('just-clone');
const log = require('./logger');

function getCPULimit() {
  return (os.cpus().length);
}

function isLetter(str) {
  return str.length === 1 && str.match(/[a-z]/i);
}

function wrapInQuotes(str) {
  return `"${str}"`;
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

function escapeRegex(strReplace) {
  // eslint-disable-next-line no-useless-escape
  return strReplace.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function replaceAllInsensitive(original, strReplace, strWith) {
  // See http://stackoverflow.com/a/3561711/556609
  const esc = escapeRegex(strReplace);
  const reg = new RegExp(esc, 'ig');
  return original.replace(reg, strWith);
}

function preferNative(preferredOpt, secondOpt, language = 'ja') {
  if (!preferredOpt) {
    return secondOpt;
  }
  if (!secondOpt) {
    return preferredOpt;
  }
  const allJapanese = /([\u4E00-\u9FFF]|[\u3040-\u309Fー]|[\u30A0-\u30FF])+/;
  const preferredOptIsJapanese = allJapanese.test(preferredOpt);
  const secondOptIsJapanese = allJapanese.test(secondOpt);
  let opt = preferredOpt;
  if (language === 'ja') {
    if (!preferredOptIsJapanese && secondOptIsJapanese) {
      opt = secondOpt;
    }
  } else if (preferredOptIsJapanese && !secondOptIsJapanese) {
    opt = secondOpt;
  }
  return opt;
}

function getFilteredOutNested(contexts) {
  const flatChildren = contexts.filter((context) => !context.directChildren);
  return flatChildren;
}

function getLocalDate(includeTime = true) {
  const date = new Date();
  const time = date.toLocaleTimeString('en-US', { hour12: false });
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0'); // January is 0!
  const yyyy = date.getFullYear();

  if (includeTime) {
    return `${mm}-${dd}-${yyyy}-${time}`;
  }
  return `${mm}-${dd}-${yyyy}`;
}

function removeEmptyKeys(obj) {
  const clonedObj = clone(obj);
  Object.entries(clonedObj).forEach(([key, value]) => {
    if (value === '' || value === null || value === undefined) {
      delete clonedObj[key];
    }
  });
  return clonedObj;
}

async function sleep(t) {
  return new Promise((rs) => setTimeout(rs, t));
}

module.exports = {
  wrapInQuotes,
  sleep,
  removeEmptyKeys,
  getCleanPath,
  isWin,
  getPathData,
  zeroPad,
  inspect,
  replaceAllInsensitive,
  escapeRegex,
  preferNative,
  getFilteredOutNested,
  getCPULimit,
  getLocalDate,
};
