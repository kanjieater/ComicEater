const fs = require('fs-extra');
const util = require('util');
const path = require('path');

const exec = util.promisify(require('child_process').exec);
const archiver = require('archiver');
const pLimit = require('p-limit');

const log = require('./logger');
const {
  glob,
} = require('./files');

const {
  isWin, getPathData, wrapInQuotes, replaceAllInsensitive, getCPULimit, inspect,
} = require('./utils');

// const EXEC_LIMIT = pLimit(getCPULimit());
const EXEC_LIMIT = pLimit(8);

async function callProgram(command, params = []) {
  if (isWin()) {
    throw new Error('Windows commands are not yet supported');
  }
  log.debug(`Running command: "${command} ${params.join(' ')}"`);
  return EXEC_LIMIT(async () => exec(`${command} ${params.join(' ')}`));
}

async function convertWSLToWindowsPath(inputPath) {
  const { stdout, stderr } = await callProgram('wslpath', ['-w', wrapInQuotes(inputPath)]);
  if (stderr) {
    throw new Error(stderr);
  }
  return replaceAllInsensitive(stdout, '\n', '');
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

async function extract7z(archivePath, extractPath) {
  await validate7Zip(archivePath);
  await callProgram('7z', [
    'x',
    wrapInQuotes(archivePath),
    '-aos', // Skip extracting of existing files.
    wrapInQuotes(`-o${extractPath}`),
  ]);
  return extractPath;
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

// CORRUPTS ON CREATION OF ARCHIVES for large amounts of files!
// function zipDirectory(source, fullZipFilePath) {
//   const archive = archiver('zip', { zlib: { level: 0 } });
//   const stream = fs.createWriteStream(fullZipFilePath);

//   return new Promise((resolve, reject) => {
//     archive
//       .directory(source, false)
//       .on('error', (err) => reject(err))
//       .pipe(stream);
//     stream.on('close', () => resolve());
//     archive.finalize();
//   });
// }

async function zipDirectory(sourceDir, destinationZip) {
  try {
    return await callProgram('7z', [
      'a', // Add files to archive
      '-tzip', // Specify ZIP format
      '-mx=0', // Set compression level to 0 (no compression)
      wrapInQuotes(destinationZip), // Destination ZIP file path
      wrapInQuotes(sourceDir), // Source directory to compress
    ]);
  } catch (error) {
    throw new Error(`Failed to create ZIP archive: ${error.message}`);
  }
}

async function validateImagesExist(dirToArchive) {
  return (await glob([{ escape: path.resolve(dirToArchive) }, { raw: '/**/*' }])).length > 0;
}

async function zipArchive(dirToArchive, archivePath) {
  const { fileName, dir } = getPathData(archivePath);
  const fullZipPath = `${dir}/${fileName}.cbz`;
  const contentExists = await validateImagesExist(dirToArchive);
  if (!contentExists) {
    throw new Error(`The path "${dirToArchive}" did not have any content in it.`);
  }
  log.info(`Zipping ${fullZipPath}`);
  await zipDirectory(dirToArchive, fullZipPath);
  return fullZipPath;
}

function getNewFilePath(archivePath, newExt) {
  const { fileName, dir } = getPathData(archivePath);
  const newFilePath = `${dir}/${fileName}.${newExt}`;

  log.debug(`New file would be: "${newFilePath}"`);
  return newFilePath;
}

async function getArchives(startPath, extensions = ['7z', 'rar', 'zip', 'cbr', 'cbz'], context = {}) {
  const format = `{${extensions.join(',')}}`;

  const archives = await glob([{
    escape: path.resolve(startPath),
  }, {
    raw: `/**/*.${format}`,
  }]);
  log.debug(`Found these archives ${inspect(archives)}`);
  return archives.map((archivePath) => ({ ...context, archivePath }));
}

module.exports = {
  validateArchive,
  extract7z,
  zipArchive,
  validateRar,
  validate7Zip,
  callProgram,
  getNewFilePath,
  getArchives,
  validateImagesExist,
  convertWSLToWindowsPath,
};
