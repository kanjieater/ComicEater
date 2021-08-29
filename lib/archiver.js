const glob = require('fast-glob');
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const archiver = require('archiver');

const log = require('./logger');
const image = require('./image');
const {
  rm, moveFile, checkPathExists, removeEmptyDirs,
} = require('./files');
const { getResults, logSagaResults, SubSagaError } = require('./saga');

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

async function extractFileFromArchive(internalFilePath, archivePath, extractPath) {
  await validate7Zip(archivePath);
  await callProgram('7z', [
    'e',
    wrapInQuotes(archivePath),
    '-aoa',
    wrapInQuotes(`-o${extractPath}`),
    wrapInQuotes(internalFilePath),
  ]);
  return `${extractPath}${internalFilePath}`;
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

async function extractRar(archivePath, extractPath) {
  await validateRar(archivePath);
  await callProgram('unrar', [
    'x',
    '-p-', // Do not query password
    '-r', // recurse subdirectories, but this doesn't seem like it does anything
    '-y', // assume yes
    '-o-', // Don't overwrite existing files
    wrapInQuotes(archivePath),
    wrapInQuotes(extractPath),
  ]);
  return extractPath;
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

async function addDirToArchive(localDir, archivePath) {
  await validate7Zip(archivePath);
  await callProgram('7z', [
    'a',
    wrapInQuotes(archivePath),
    wrapInQuotes(`${localDir}*`),
  ]);
  return archivePath;
}

const strategies = {
  '.rar': extractRar,
  '.7z': extract7z,
};

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

// Must return the directory they extracted to
async function extractArchiveInPlace(archivePath, validArchiveType) {
  const { dir, fileName } = getPathData(archivePath);
  const extractPath = `${dir}/${fileName}/`;
  log.info(`Extracting "${extractPath}"`);
  return strategies[validArchiveType](archivePath, extractPath);
}

async function zipArchive(dirToArchive, archivePath) {
  const { fileName, dir } = getPathData(archivePath);
  const fullZipPath = `${dir}/${fileName}.cbz`;
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

async function validateContents(extractedArchiveDir) {
  return image.validateImageDir(extractedArchiveDir);
}

async function getArchives(startPath, extensions = ['7z', 'rar', 'zip', 'cbr', 'cbz'], context = {}) {
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
  return archives.map((archivePath) => ({ ...context, archivePath }));
}

async function startNestedArchivesSaga(archivePaths) {
  log.debug(`${archivePaths.length} nested archives found in: "${archivePaths}\n ${util.inspect(archivePaths)}"`);
  // Start the recursion
  // eslint-disable-next-line no-use-before-define
  const results = await convertToCBZBatch(archivePaths, CONVERT_NESTED_TO_CBZ);
  logSagaResults(results);
  return results;
}

async function getNestedArchivePaths(extractedArchiveDir, rootPath) {
  log.debug(`Checking for nested archives in: "${extractedArchiveDir}"`);
  const archivePaths = await getArchives(extractedArchiveDir);
  const updatedArchivePaths = archivePaths.map((context) => ({
    ...context,
    rootPath,
  }));
  return updatedArchivePaths;
}

async function getNestedArchives(extractedArchiveDir, rootPath) {
  const nestedArchives = await getNestedArchivePaths(extractedArchiveDir, rootPath);
  let wasNested = true;
  let nestedArchivesResult;
  if (nestedArchives.length) {
    nestedArchivesResult = await startNestedArchivesSaga(nestedArchives);
  } else {
    log.debug(`No nested archives found in: "${extractedArchiveDir}"`);
    wasNested = false;
  }
  return { nestedArchivesResult, directChildren: nestedArchives, wasNested };
}

function getRootArchivePath(existingRootPath, archivePath) {
  if (existingRootPath) {
    const { fileName } = getPathData(archivePath);
    const { dir } = getPathData(existingRootPath);
    return `${dir}/${fileName}.cbz`;
  }
  return archivePath;
}

async function cleanUpNestedArchive(context, extractedArchiveDir) {
  if (context.subSagaResults.unsuccessful.length !== 0) {
    throw new SubSagaError(
      `Child archive failed so the parent archive will not be removed. ${context.archivePath}`,
      context.subSagaResults,
    );
  }
  await rm(context.archivePath, false);
  await removeEmptyDirs(extractedArchiveDir);
}

async function zipAndMove(extractedArchiveDir, archivePath, newZipPath) {
  const hasValidContents = await validateContents(extractedArchiveDir);
  if (!hasValidContents) {
    throw new Error(`Corrupted Images found for "${archivePath}"`);
  }

  const zippedPath = await zipArchive(extractedArchiveDir, archivePath);
  await validateArchive(zippedPath);

  const pathExists = await checkPathExists(newZipPath);
  if (!pathExists) {
    await moveFile(zippedPath, newZipPath);
    await rm(archivePath, false);
  } else if (newZipPath === zippedPath) {
    await rm(archivePath, false);
  }
  await rm(extractedArchiveDir, false);
}

async function convertToCBZ(context) {
  const { archivePath, rootPath } = context;
  const newFilePath = getNewFilePath(archivePath, 'cbz');
  const updatedContext = { ...context, action: CONVERT_TO_CBZ, recordChange: false };
  if (await checkPathExists(newFilePath)) {
    log.info(`"${archivePath}" already exists. Skipping.`);
    return { ...updatedContext, archivePath: newFilePath };
  }
  const validArchiveType = await validateArchive(archivePath);
  const extractedArchiveDir = await extractArchiveInPlace(archivePath, validArchiveType);
  if (!extractedArchiveDir) {
    throw new Error(`Could not extract "${archivePath}"`);
  }

  const {
    nestedArchivesResult,
    directChildren,
    wasNested,
  } = await getNestedArchives(extractedArchiveDir, rootPath || archivePath);

  let newZipPath = null;
  if (wasNested) {
    newZipPath = extractedArchiveDir;
    updatedContext.rootPath = getRootArchivePath(rootPath, archivePath);
    updatedContext.subSagaResults = nestedArchivesResult;
    updatedContext.directChildren = directChildren;
    await cleanUpNestedArchive(updatedContext, extractedArchiveDir);
  } else {
    newZipPath = getRootArchivePath(rootPath, newFilePath);
    await zipAndMove(extractedArchiveDir, archivePath, newZipPath);
  }

  return {
    ...updatedContext,
    archivePath: newZipPath,
    originalArchivePath: archivePath,
    recordChange: true,
  };
}

function getFilteredOutNested(contexts) {
  const flatChildren = contexts.filter((context) => !context.directChildren);
  return flatChildren;
}

async function convertToCBZBatch(archivePaths, action = CONVERT_TO_CBZ) {
  const results = await getResults(action, archivePaths, convertToCBZ);
  return results;
}

module.exports = {
  convertToCBZ,
  convertToCBZBatch,
  getArchives,
  addDirToArchive,
  extractFileFromArchive,
  getFilteredOutNested,
  actions,
};
