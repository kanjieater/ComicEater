const glob = require('fast-glob');
// const fs = require('fs').promises;
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const archiver = require('archiver');

const image = require('./image');
const { rm } = require('./files');
const { log } = require('./logger');

const {
  isWin, getPathData,
} = require('./utils');

function wrapInQuotes(str) {
  // return `${str.replace(/ /g, '%')}`;
  return `"${str}"`;
}

async function callProgram(command, params = []) {
  // TODO figure out why spawn doesn't work with quoted paths... resorting to exec
  if (isWin()) {
    throw new Error('Windows commands are not yet supported');
  }
  log(`Running command: "${command} ${params.join(' ')}"`);
  await exec(`${command} ${params.join(' ')}`);
}

async function extract7z(archivePath, extractPath) {
  await callProgram('7z', [
    'x',
    wrapInQuotes(archivePath),
    '-aos',
    wrapInQuotes(`-o${extractPath}/`),
  ]);
  return extractPath;
}

const strategies = {
  '.rar': extract7z,
  '.cbr': extract7z,
  '.zip': extract7z,
  '.7z': extract7z,
};

async function addDirToArchive(localDir, archivePath) {
  await callProgram('7z', [
    'a',
    wrapInQuotes(archivePath),
    wrapInQuotes(`${localDir}*`),
  ]);
  return archivePath;
}

async function extractFileFromArchive(internalFilePath, archivePath, extractPath) {
  await callProgram('7z', [
    'e',
    wrapInQuotes(archivePath),
    '-aoa',
    wrapInQuotes(`-o${extractPath}`),
    wrapInQuotes(internalFilePath),
  ]);
  return `${extractPath}${internalFilePath}`;
}

async function validateArchive(archivePath) {
  log(`Validating archive "${archivePath}"`, 'debug');
  try {
    await callProgram('7z', [
      't',
      wrapInQuotes(archivePath),
    ]);
  } catch (e) {
    throw new Error(`Failed archive validation for "${archivePath}"\n "${e.stack}"`);
  }
}

function zipDirectory(source, fullZipFilePath) {
  const archive = archiver('zip', { zlib: { level: 0 } });
  const stream = fs.createWriteStream(fullZipFilePath);

  return new Promise((resolve, reject) => {
    archive
      .directory(source, false)
      .on('error', (err) => reject(err))
      .pipe(stream);
    stream.on('close', () => resolve());
    archive.finalize();
  });
}

// Must return the directory they extracted to
async function extractArchiveInPlace(archivePath) {
  const { ext, dir, fileName } = getPathData(archivePath);
  const extractPath = `${dir}/${fileName}/`;
  if (strategies[ext]) {
    log(`Extracting "${extractPath}"`, 'info');
    return strategies[ext](archivePath, extractPath);
  }
  log(`Extension not supported for "${archivePath}"`, 'warn');
  return null;
}

function zipArchive(dirToArchive, { fileName, dir }) {
  const fullZipPath = `${dir}/${fileName}.cbz`;
  log(`Zipping ${fullZipPath}`, 'info');
  return zipDirectory(dirToArchive, fullZipPath)
    .then(() => fullZipPath);
}

async function checkIfFileExists(filePath) {
  return fs.promises.access(filePath, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

function getNewFilePath(archivePath, newExt) {
  const { fileName, dir } = getPathData(archivePath);
  const newFilePath = `${dir}/${fileName}.${newExt}`;
  log(`New file would be: "${newFilePath}"`, 'debug');
  return newFilePath;
}

async function validateContents(extractedArchiveDir) {
  return image.validateImageDir(extractedArchiveDir);
}

async function convertToCBZ(archivePath) {
  const pathData = getPathData(archivePath);
  const newFilePath = getNewFilePath(archivePath, 'cbz');
  if (await checkIfFileExists(newFilePath)) {
    log(`"${archivePath}" already exists. Skipping.`, 'info');
    // return Promise.reject(new Error('Archive already exists'));
    return newFilePath;
  }
  await validateArchive(archivePath);

  const extractedArchiveDir = await extractArchiveInPlace(archivePath);

  const hasValidContents = await validateContents(extractedArchiveDir);
  if (!hasValidContents) {
    throw new Error(`Corrupted Images found for "${archivePath}"`);
  }

  if (extractedArchiveDir && hasValidContents) {
    const newZipPath = await zipArchive(extractedArchiveDir, pathData);
    // const newArchivePath = changeExtension(newZipPath);
    await validateArchive(newZipPath);
    // Delete the original if we got an extracted and rezipped on
    await rm(extractedArchiveDir, false);
    await rm(archivePath, false);
    return newZipPath;
  }
  // log(dir);
  return Promise.reject(new Error('Failed to convert to CBZ'));
}

async function convertToCBZBatch(archivePaths) {
  const converted = [];
  const unconverted = [];

  await Promise.all(archivePaths.map(
    async (archivePath) => convertToCBZ(archivePath)
      .then((newArchivePath) => converted.push(newArchivePath))
      .catch((error) => unconverted.push({ error, archivePath })),
  ));

  let failedMessage = '';
  unconverted.forEach(({ error, archivePath }, index) => {
    failedMessage += `Failed converting ${index + 1}/${unconverted.length} "${archivePath}" because of:\n ${error.stack || error}\n`;
  });
  log(`Converted ${converted.length}.
  Failed: ${unconverted.length}
  ${failedMessage}`, 'info');
}

async function getArchives(startPath, extensions = ['7z', 'rar', 'zip', 'cbr', 'cbz']) {
  const escapedStartPath = glob.escapePath(startPath);
  let format = `${extensions.join(',')}`;
  if (extensions.length === 1) {
    [format] = extensions;
  }
  let globPath = `${escapedStartPath}/**/*.${format}`;
  try {
    const isFile = await fs.promises.lstat(startPath).isFile();
    if (isFile) {
      globPath = escapedStartPath;
    }
  } catch (e) {
    if (e instanceof TypeError) {
      // pass and try globbing
    } else {
      throw e;
    }
  }

  log(`Looking for ${globPath}`, 'debug');
  return glob(globPath);
}

module.exports = {
  convertToCBZ,
  convertToCBZBatch,
  getArchives,
  addDirToArchive,
  extractFileFromArchive,
};
