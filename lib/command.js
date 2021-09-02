const fs = require('fs');
const util = require('util');
const { resolve } = require('path');
const exec = util.promisify(require('child_process').exec);
const archiver = require('archiver');

const log = require('./logger');
const {
  rm, moveFile, checkPathExists,
} = require('./files');

const { isWin, getPathData, glob } = require('./utils');

function wrapInQuotes(str) {
  // return `${str.replace(/ /g, '%')}`;
  return `"${str}"`;
}

async function callProgram(command, params = []) {
  // TODO figure out why spawn doesn't work with quoted paths... resorting to exec
  if (isWin()) {
    throw new Error('Windows commands are not yet supported');
  }
  log.debug(`Running command: "${command} ${params.join(' ')}"`);
  await exec(`${command} ${params.join(' ')}`);
}

async function validate7Zip(archivePath) {
  try {
    await callProgram('7z', [
      't',
      wrapInQuotes(archivePath),
    ]);
  } catch (e) {
    throw new Error(`Failed archive validation for "${archivePath}"\n "${e.stack}"`);
  }
}

async function validateRar(archivePath) {
  try {
    await callProgram('unrar', [
      't',
      wrapInQuotes(archivePath),
    ]);
  } catch (e) {
    throw new Error(`Failed archive validation for "${archivePath}"\n "${e.stack}"`);
  }
}

async function validateArchive(archivePath) {
  log.debug(`Validating archive "${archivePath}"`);
  let archiveMethod = null;
  try {
    await validate7Zip(archivePath);
    archiveMethod = '.7z';
  } catch (e) {
    // 7zip can handle everything even rars - so it's usually the better option...
    // BUT. Sometimes it can't validate things that unrar can.🤢
    try {
      await validateRar(archivePath);
      archiveMethod = '.rar';
    } catch (rarError) {
      // If it fails just pass out the original 7z error. It's good enough.
      log.warn(rarError);
      throw new Error(`Failed archive validation for "${archivePath}"\n "${e.stack}"`);
    }
  }
  return archiveMethod;
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

async function zipArchive(dirToArchive, archivePath) {
  const { fileName, dir } = getPathData(archivePath);
  const fullZipPath = `${dir}/${fileName}.cbz`;
  const contentExists = (await glob([{ escape: resolve(dirToArchive) }, { raw: '/**/*' }])).length > 0;
  if (!contentExists) {
    throw new Error(`The path "${dirToArchive}" did not have any content in it.`);
  }
  log.info(`Zipping ${fullZipPath}`);
  await zipDirectory(dirToArchive, fullZipPath);
  return fullZipPath;
}

async function zipAndMove(
  extractedArchiveDir, cleanedArchivePath, targetPath, originalArchivePath,
) {
  const zippedPath = await zipArchive(extractedArchiveDir, cleanedArchivePath);
  await validateArchive(zippedPath);

  const pathExists = await checkPathExists(targetPath);
  if (!pathExists) {
    await moveFile(zippedPath, targetPath);
    if (originalArchivePath) {
      await rm(originalArchivePath, false);
    }
  } else if (targetPath === zippedPath && originalArchivePath) {
    await rm(originalArchivePath, false);
  }
  await rm(extractedArchiveDir, false);
}

function getNewFilePath(archivePath, newExt) {
  const { fileName, dir } = getPathData(archivePath);
  const newFilePath = `${dir}/${fileName}.${newExt}`;

  log.debug(`New file would be: "${newFilePath}"`);
  return newFilePath;
}

module.exports = {
  zipAndMove,
  validateArchive,
  validateRar,
  validate7Zip,
  wrapInQuotes,
  callProgram,
  getNewFilePath,
};