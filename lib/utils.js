const path = require('path');
const { inspect } = require('util');
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

function logContext(context, error) {
  const message = `Context at the point of "${context.action}" for "${context.archivePath}":\n${inspect(context || {}, { depth: null })}"`;
  log.debug(message);
  if (error) {
    log.error(error.stack);
  }
}

async function getResults(action, arr, getResult, onFail = (context) => context) {
  const successful = [];
  const unsuccessful = [];
  async function internalCallback(context) {
    try {
      const resultingContext = await getResult(context);
      logContext(resultingContext);
      successful.push(resultingContext);
    } catch (error) {
      const contextResponse = await onFail(context, error);
      logContext(contextResponse, error);
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
    action,
  };
}

module.exports = {
  getCleanPath,
  isWin,
  getPathData,
  getResults,
};
