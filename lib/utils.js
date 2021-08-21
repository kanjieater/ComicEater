const path = require('path');
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
  log.debug(`Converting "${argPath}" to standardized path`);
  let normalPath = argPath.split('\\').join(path.posix.sep);

  // const noDriveLetter = normalPath.replace(new RegExp('^[a-zA-Z]:'), '')
  // console.log.debug(noDriveLetter)

  if (!isWin() && normalPath.length > 1 && isLetter(normalPath[0]) && normalPath[1] === ':') {
    // TODO: Assume wsl path

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

async function defaultOnFail(context) {
  return context;
}

async function getResults(arr, getResult, onFail = defaultOnFail) {
  const successful = [];
  const unsuccessful = [];
  async function internalCallback(context) {
    try {
      const result = await getResult(context);
      successful.push(result);
    } catch (error) {
      const contextResponse = await onFail(context, error);
      unsuccessful.push({ error, context: contextResponse });
    }
  }
  await Promise.all(
    arr.map(
      async (context) => internalCallback(context),
    ),
  );
  return {
    successful,
    unsuccessful,
  };
}

module.exports = {
  getCleanPath,
  isWin,
  getPathData,
  getResults,
};
