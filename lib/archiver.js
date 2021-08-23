const glob = require('fast-glob');
// const fs = require('fs').promises;
const clone = require('just-clone');
const merge = require('deepmerge');
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const archiver = require('archiver');

const log = require('./logger');
const image = require('./image');
const {
  rm, moveFile, removeAllEmptyDirs, checkPathExists, removeEmptyDirs,
} = require('./files');
const { getResults, logSagaResults, getSubSagaResults } = require('./saga');

const {
  isWin, getPathData,
} = require('./utils');

const CONVERT_TO_CBZ = 'Convert to CBZ';
const CONVERT_NESTED_TO_CBZ = 'Convert Nested Archives to CBZ';
const MERGE_NESTED_SUB_FOLDERS = 'Merge Nested Sub Folders';
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

async function zipArchive(dirToArchive, { fileName, dir }) {
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
  if (await checkPathExists(newFilePath)) {
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
  const nestedArchives = await getNestedArchives(extractedArchiveDir);
  // eslint-disable-next-line no-use-before-define
  const nestedArchivesResult = await handleNestedArchives(nestedArchives);
  const wasNested = !!nestedArchivesResult;
  let newZipPath = null;
  if (wasNested) {
    newZipPath = extractedArchiveDir;
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
    nestedArchives: nestedArchivesResult,
    directChildren: nestedArchives,
    originalArchivePath: archivePath,
    recordChange: true,
  };
}

function getDirectChildren(originalArchivePath, directChildren) {
  const dc = directChildren.find(
    (directChild) => directChild.archivePath === originalArchivePath,
  );
  return dc;
}

function getFlatDirectChildrenResults(contexts) {
  // const flatChildren = contexts.filter((context) => context.nestedArchives);
  // return getDirectChildren(flatChilren);

  return contexts.filter(
    (child) => child.directChildren.length === 0,
  );
}

function getFilteredOutNested(contexts) {
  const flatChildren = contexts.filter((context) => !context.nestedArchives);
  return flatChildren;
}

function getNestedDirectChildrenResults(contexts) {
  const nestedChildren = contexts.filter((context) => context.nestedArchives);
  return nestedChildren;
  // return nestedChildren.filter(
  //   (child) => getDirectChildren(child.originalArchivePath, child.directChildren),
  // );
}

async function getDeepNestedPaths(archivePath) {
  const archives = await getArchives(archivePath, ['cbz']);
  log.debug(`These deeply nested CBZ's were found as well ${util.inspect(archives)}`);
  return archives;
}

async function verifyChildrenPresent(archivesWorkedOn, directChildren, unsuccessful) {
  const missingChildren = { missing: [] };
  if (unsuccessful.length !== 0) {
    missingChildren.missing = unsuccessful;
    return missingChildren;
  }
  return missingChildren;
}

async function filterOutNonexistantResults(contexts) {
  async function callback(context) {
    if (await checkPathExists(context.archivePath)) {
      return context;
    }
    return false;
  }
  const filtered = await Promise.all(
    contexts.map(async (context) => callback(context)),
  );
  return filtered.filter((c) => c);
}

async function startMergeSubFoldersSaga(resultsSaga) {
  // const archivesMerged = {};
  async function internalCallback(nestedContext) {
    const targetArchivePath = nestedContext.archivePath;
    const { dir } = getPathData(targetArchivePath);

    async function moveNestedToParent(context) {
      const childFilePath = context.archivePath;
      const { fileName: childFileName, ext: childFileExtension } = getPathData(childFilePath);
      const newArchivePath = `${targetArchivePath}${childFileName}${childFileExtension}`;

      // File may not exist if others have swept it up
      const pathExists = await checkPathExists(newArchivePath);
      if (!pathExists) {
        await moveFile(childFilePath, newArchivePath);
      }
      return {
        ...context,
        // originalArchivePath: childFilePath,
        archivePath: newArchivePath,
        recordChange: true,
        action: MERGE_NESTED_SUB_FOLDERS,
      };
    }
    const directChildren = getFlatDirectChildrenResults(nestedContext.nestedArchives.successful);
    const nestedResults = await getDeepNestedPaths(`${targetArchivePath}`);
    // const directChildren = nestedContext.nestedArchives.successful;
    const sagaResults = await getResults(
      MERGE_NESTED_SUB_FOLDERS, nestedResults, moveNestedToParent,
    );
    // TODO only delete when you know children are present
    const allChildrenAccountedFor = await verifyChildrenPresent(
      nestedResults, directChildren, sagaResults.unsuccessful,
    );
    if (allChildrenAccountedFor.missing.length === 0) {
      await rm(nestedContext.originalArchivePath, false);
      // Add your history to the child
    } else {
      throw new Error(`Children are missing: ${util.inspect(allChildrenAccountedFor.missing)}`);
    }
    await removeEmptyDirs(dir);
    return sagaResults;
  }
  const nestedResults = getNestedDirectChildrenResults(resultsSaga.successful);
  const reverseNestedResults = nestedResults.reverse();
  let resultsList;
  try {
    resultsList = await Promise.all(
      reverseNestedResults.map(async (context) => internalCallback(context)),
    );
  } catch (e) {
    resultsList = [{ successful: [], unsuccessful: [e], action: MERGE_NESTED_SUB_FOLDERS }];
  }
  const sagaResults = merge.all(resultsList);
  // TODO fix this hack
  sagaResults.successful = await filterOutNonexistantResults(sagaResults.successful);
  return sagaResults;
}

function mergeResults(results) {
  const { successful, unsuccessful } = results;

  let newSuccessful = [...clone(successful)];
  let newUnsuccessful = [...clone(unsuccessful)];

  successful.forEach((parent) => {
    if (!parent.nestedArchives) {
      return;
    }
    parent.nestedArchives.successful.forEach((child) => {
      newSuccessful = newSuccessful.concat(child);
    });
  });

  unsuccessful.forEach((parent) => {
    if (!parent.nestedArchives) {
      return;
    }
    parent.nestedArchives.unsuccessful.forEach((child) => {
      newUnsuccessful = newUnsuccessful.concat(child);
    });
  });

  return {
    ...results,
    successful: newSuccessful,
    unsuccessful: newUnsuccessful,
  };
}

async function startMergeNestedSagaResults(results) {
  log.debug(`Merging ${results.successful.length} successes & ${results.unsuccessful.length} failures results:\n ${util.inspect(results)}`);

  const mergedResults = mergeResults(results);
  log.debug(`Merged ${results.successful.length} successes & ${results.unsuccessful.length} failures results:\n ${util.inspect(results)}`);
  return mergedResults;
}

function checkForNestedResults(results) {
  const nestedSuccess = results.successful.find((result) => !!result.nestedArchives);
  const nestedFailure = results.unsuccessful.find((result) => !!result.nestedArchives);
  const hasNestedArchives = Boolean(nestedSuccess || nestedFailure);
  log.debug(`Has Nested Results: ${hasNestedArchives}`);
  return hasNestedArchives;
}

async function convertToCBZBatch(archivePaths, action = CONVERT_TO_CBZ) {
  const results = await getResults(action, archivePaths, convertToCBZ);
  const hasNestedArchives = checkForNestedResults(results);
  let finalResults = results;
  if (hasNestedArchives) {
    finalResults = await startMergeNestedSagaResults(results);
    logSagaResults(finalResults);
  }
  return finalResults;
}

async function getNestedArchives(extractedArchiveDir) {
  log.debug(`Checking for nested archives in: "${extractedArchiveDir}"`);
  const archivePaths = await getArchives(extractedArchiveDir);
  return archivePaths;
}

async function handleNestedArchives(archivePaths) {
  if (!archivePaths.length) {
    log.debug(`${archivePaths.length} nested archives found in: "${archivePaths}"`);
    return false;
  }
  log.debug(`${archivePaths.length} nested archives found in: "${archivePaths}\n ${util.inspect(archivePaths)}"`);

  const results = convertToCBZBatch(archivePaths, CONVERT_NESTED_TO_CBZ);
  return results;
}

module.exports = {
  convertToCBZ,
  convertToCBZBatch,
  getArchives,
  addDirToArchive,
  extractFileFromArchive,
  startMergeSubFoldersSaga,
  getFilteredOutNested,
  actions,
};
