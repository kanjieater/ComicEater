const glob = require('fast-glob');
// const fs = require('fs').promises;
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const archiver = require('archiver');

const log = require('./logger');
const image = require('./image');
const { rm } = require('./files');
const { getResults } = require('./saga');

const {
  isWin, getPathData,
} = require('./utils');

const CONVERT_TO_CBZ = 'Convert to CBZ';
const CONVERT_NESTED_TO_CBZ = 'Convert Nested Archives to CBZ';
const actions = {
  CONVERT_TO_CBZ,
};

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

async function extract7z(archivePath, extractPath) {
  await callProgram('7z', [
    'x',
    wrapInQuotes(archivePath),
    '-aos',
    wrapInQuotes(`-o${extractPath}`),
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
  log.debug(`Validating archive "${archivePath}"`);
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
    log.info(`Extracting "${extractPath}"`);
    return strategies[ext](archivePath, extractPath);
  }
  log.warn(`Extension not supported for "${archivePath}"`);
  return null;
}

function zipArchive(dirToArchive, { fileName, dir }) {
  const fullZipPath = `${dir}/${fileName}.cbz`;
  log.info(`Zipping ${fullZipPath}`);
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
  log.debug(`New file would be: "${newFilePath}"`);
  return newFilePath;
}

async function validateContents(extractedArchiveDir) {
  return image.validateImageDir(extractedArchiveDir);
}

async function getArchives(startPath, extensions = ['7z', 'rar', 'zip', 'cbr', 'cbz']) {
  const escapedStartPath = glob.escapePath(startPath);
  let format = `{${extensions.join(',')}}`;
  if (extensions.length === 1) {
    [format] = extensions;
  }
  let globPath = `${escapedStartPath}**/*.${format}`;
  try {
    const lstat = await fs.promises.lstat(startPath);
    const isFile = lstat.isFile();
    if (isFile) {
      globPath = escapedStartPath;
    }
  } catch (e) {
    if (e instanceof TypeError) {
      // pass and try globbing
      log.info("File wasn't found, but will still try to glob");
    } else {
      throw e;
    }
  }

  log.debug(`Looking for ${globPath}`);
  const archives = await glob(globPath);
  return archives.map((archivePath) => ({ archivePath }));
}

async function convertToCBZ(context) {
  const { archivePath } = context;
  const pathData = getPathData(archivePath);
  const newFilePath = getNewFilePath(archivePath, 'cbz');
  const updatedContext = { ...context, action: CONVERT_TO_CBZ, recordChange: false };
  if (await checkIfFileExists(newFilePath)) {
    log.info(`"${archivePath}" already exists. Skipping.`);
    return { ...updatedContext, archivePath: newFilePath };
  }
  await validateArchive(archivePath);

  const extractedArchiveDir = await extractArchiveInPlace(archivePath);
  if (!extractedArchiveDir) {
    throw new Error(`Could not extract "${archivePath}"`);
  }

  // TODO fix lint issue
  // eslint-disable-next-line no-use-before-define
  const nestedArchives = await handleNestedArchives(extractedArchiveDir);
  const wasNested = !!nestedArchives;
  let newZipPath = null;
  if (wasNested) {
    newZipPath = nestedArchives.successful;
  } else {
    const hasValidContents = await validateContents(extractedArchiveDir);
    if (!hasValidContents) {
      throw new Error(`Corrupted Images found for "${archivePath}"`);
    }

    newZipPath = await zipArchive(extractedArchiveDir, pathData);
    await validateArchive(newZipPath);
    await rm(extractedArchiveDir, false);
    await rm(archivePath, false);
  }
  // Delete the original if we got an extracted and rezipped on
  return {
    ...updatedContext,
    archivePath: newZipPath,
    wasNested,
    recordChange: true,
  };
}

async function convertToCBZBatch(archivePaths, action = CONVERT_TO_CBZ) {
  return getResults(action, archivePaths, convertToCBZ);
}

function filterNestedOut(contexts) {
  return contexts.filter((context) => context.wasNested);
}

async function handleNestedArchives(extractedArchiveDir) {
  log.debug(`Checking for nested archives in: "${extractedArchiveDir}"`);
  const archives = await getArchives(extractedArchiveDir);
  log.debug(`${archives.length} nested archives found in: "${extractedArchiveDir}"`);
  if (!archives.length) {
    return false;
  }
  const results = await convertToCBZBatch(archives, CONVERT_NESTED_TO_CBZ);
  if (results.unsuccessful !== 0) {
    // throw new Error()
  }
  return results;
}

module.exports = {
  convertToCBZ,
  convertToCBZBatch,
  getArchives,
  addDirToArchive,
  extractFileFromArchive,
  filterNestedOut,
  actions,
};
