const util = require('util');
const pLimit = require('p-limit');
const path = require('path');
const log = require('./logger');
const {
  validateImageDir,
  getImages,
  trimImagesWhiteSpace,
  upscaleImages,
  splitImages,
} = require('./image');

const {
  rm, moveFile, checkPathExists, removeEmptyDirs, getAllFiles, moveFilesBatch, glob,
} = require('./files');
const { getResults, logSagaResults, SubSagaError } = require('./saga');
const { getPathData, wrapInQuotes, getCPULimit } = require('./utils');
const { removeJunk } = require('./format');
const { getNestedVolumes, cleanUpNestedVolume } = require('./volumeFinder');
const {
  zipAndMove, callProgram, validate7Zip,
  validateRar, validateArchive, getNewFilePath, getArchives,
} = require('./command');

const CONVERT_TO_CBZ = 'Convert to CBZ';
const CONVERT_NESTED_TO_CBZ = 'Convert Nested Archives to CBZ';

const actions = {
  CONVERT_TO_CBZ,
};

async function listArchiveContents(archivePath) {
  const { stdout } = await callProgram('7z', ['l', '-ba', wrapInQuotes(archivePath)]);
  const lines = stdout.split('\n').map((line) => line.trim());

  const fileNames = lines.map((line) => {
    const fileNameWithSpaces = line.split(/\s+/).slice(4).join(' '); // Split by spaces and take the part after the fourth group
    const fileNameParts = fileNameWithSpaces.split(' '); // Split once more after the first space
    const fileName = fileNameParts.slice(1).join(' '); // Take the latter half of the split
    return fileName;
  }).filter(Boolean); // Filter out any empty or undefined entries

  return fileNames;
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
  return path.join(extractPath, path.basename(internalFilePath));
}

// const LIMIT_RAR = pLimit(getCPULimit());
const LIMIT_RAR = pLimit(1);
async function extractRar(archivePath, extractPath) {
  await validateRar(archivePath);
  await LIMIT_RAR(() => callProgram('unrar', [
    'x',
    '-p-', // Do not query password
    '-r', // recurse subdirectories, but this doesn't seem like it does anything
    '-y', // assume yes
    '-o-', // Don't overwrite existing files
    wrapInQuotes(archivePath),
    wrapInQuotes(extractPath),
  ]))();
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
  try {
    await callProgram('7z', [
      'a',
      wrapInQuotes(archivePath),
      wrapInQuotes(`${localDir}*`),
    ]);
  } catch (e) {
    throw new Error(e);
  }
  return archivePath;
}

const strategies = {
  '.rar': extractRar,
  '.7z': extract7z,
};

async function getFiles(startPath, fileNames) {
  if (!fileNames) {
    return [];
  }
  return glob([{
    escape: startPath,
  }, {
    raw: '**/(',
  }, {
    raw: fileNames.join('|'),
  },
  {
    raw: ')',
  }]);
}

async function getFilesWithExt(startPath, extensions) {
  if (!extensions) {
    return [];
  }
  return glob([{
    escape: startPath,
  }, {
    raw: '**/*.',
  },
  {
    raw: `{${extensions.join(',')}}`,
  }]);
}

async function removeFilesToDelete(extractedDir, filesToDelete, filesToDeleteWithExtensions) {
  const filesToDeletePaths = await getFiles(extractedDir, filesToDelete);
  const filesToDeleteWithExt = await getFilesWithExt(extractedDir, filesToDeleteWithExtensions);
  return Promise.all(
    [...filesToDeletePaths, ...filesToDeleteWithExt].map(async (filePath) => rm(filePath, false)),
  );
}

function checkForDuplicates(filePaths) {
  return new Set(filePaths).size !== filePaths.length;
}

async function cleanArchiveContents(
  originalDir, {
    filesToDelete, junkToFilter, filesToAllow, filesToDeleteWithExtensions,
  },
) {
  await removeFilesToDelete(originalDir, filesToDelete, filesToDeleteWithExtensions);
  const allFiles = await getAllFiles(originalDir);
  const allCleanedFiles = allFiles.map((filePath) => removeJunk(filePath, junkToFilter));
  const cleanedExtractedDir = `${removeJunk(originalDir, junkToFilter)}/`;

  const hasDupes = checkForDuplicates(allCleanedFiles);
  if (hasDupes) {
    throw new Error(`Failed to clean as two files have the same name after cleaning: "${originalDir}"`);
  }
  const zippedFromTo = allFiles.map(
    (originalFilePath, i) => [originalFilePath, allCleanedFiles[i]],
  );
  await moveFilesBatch(zippedFromTo);
  await removeEmptyDirs(originalDir);
  const allowedFiles = await getFiles(cleanedExtractedDir, filesToAllow);
  const imagePaths = await getImages(cleanedExtractedDir);
  const archives = await getArchives(cleanedExtractedDir);
  const archivePaths = archives.map(({ archivePath }) => archivePath);
  if (imagePaths.length === 0 && archivePaths.length === 0) {
    throw new Error(`No images were detected in ${cleanedExtractedDir}`);
  }
  const cleanedAllowedFiles = [...imagePaths, ...archivePaths, ...allowedFiles];
  const unexpectedFiles = allCleanedFiles.filter(
    (filePath) => !cleanedAllowedFiles.includes(filePath),
  );

  return {
    extractedArchiveDir: cleanedExtractedDir,
    unexpectedFiles,
  };
}

// Must return the directory they extracted to
async function extractArchiveInPlace(archivePath, validArchiveType, cleanFileName) {
  const { dir, fileName } = getPathData(cleanFileName);
  const extractPath = `${dir}/${fileName}/`;
  log.info(`Extracting "${extractPath}"`);
  return strategies[validArchiveType](archivePath, extractPath);
}

async function validateContents(extractedArchiveDir, originalArchivePath) {
  const hasValidContents = await validateImageDir(extractedArchiveDir);
  if (!hasValidContents.isValid) {
    throw new Error(`Corrupted Images found for "${originalArchivePath}" because of: ${hasValidContents.error}`);
  }
}

async function convertCBZToZip(archivePath, pathAsZip) {
  const { ext } = getPathData(archivePath);
  if (ext === '.cbz') {
    await moveFile(archivePath, pathAsZip);
    return pathAsZip;
  }
  return archivePath;
}

async function startNestedArchivesSaga(archivePaths) {
  log.debug(`${archivePaths.length} nested archives found in: "${archivePaths}\n ${util.inspect(archivePaths)}"`);
  // Start the recursion
  // eslint-disable-next-line no-use-before-define
  const results = await convertToCBZBatch(archivePaths, CONVERT_NESTED_TO_CBZ);
  logSagaResults(results);
  return results;
}

async function getNestedArchivePaths(extractedArchiveDir, rootPath, context) {
  log.debug(`Checking for nested archives in: "${extractedArchiveDir}"`);
  const archivePaths = await getArchives(extractedArchiveDir);
  const updatedArchivePaths = archivePaths.map((archiveContext) => ({
    ...context,
    ...archiveContext,
    rootPath,
  }));
  return updatedArchivePaths;
}

async function getNestedArchives(extractedArchiveDir, rootPath, context) {
  const nestedArchives = await getNestedArchivePaths(extractedArchiveDir, rootPath, context);
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

async function cleanUpNestedArchive(context, extractedArchiveDir, originalArchive) {
  if (context.subSagaResults.unsuccessful.length !== 0) {
    throw new SubSagaError(
      `Child archive failed so the parent archive will not be removed. ${context.archivePath}`,
      context.subSagaResults,
    );
  }
  await rm(originalArchive, false);
  await removeEmptyDirs(extractedArchiveDir);
}

async function enhanceArchiveContents(extractedArchiveDir, context) {
  const enhancements = {};
  // convertUnsupportedFormat(extractedArchiveDir)
  if (context.trimWhiteSpace) {
    await trimImagesWhiteSpace(extractedArchiveDir);
    enhancements.trimWhiteSpace = true;
  }
  if (context.upscale) {
    await upscaleImages(extractedArchiveDir);
    enhancements.upscale = true;
  }
  if (context.splitPages) {
    await splitImages(extractedArchiveDir);
    enhancements.splitPages = true;
  }
  return enhancements;
}

async function convertToCBZ(context) {
  const {
    archivePath, rootPath, junkToFilter,
  } = context;
  let { volumeStartPath } = context;
  let deleteIfSuccessful;
  const updatedContext = { ...context, action: CONVERT_TO_CBZ, recordChange: false };
  const folderOrArchivePath = volumeStartPath || archivePath;
  const originalArchive = await convertCBZToZip(folderOrArchivePath, getNewFilePath(folderOrArchivePath, 'zip'));
  const cleanFilePath = removeJunk(originalArchive, junkToFilter);
  const newFilePath = getNewFilePath(cleanFilePath, 'cbz');

  if (await checkPathExists(newFilePath)) {
    throw new Error(`"${originalArchive}" already exists. Skipping.`);
  }
  if (!volumeStartPath) {
    const validArchiveType = await validateArchive(originalArchive);
    volumeStartPath = await extractArchiveInPlace(
      originalArchive,
      validArchiveType,
      cleanFilePath,
    );
  }

  const cleanedContents = await cleanArchiveContents(volumeStartPath, context);
  const { extractedArchiveDir, unexpectedFiles } = cleanedContents;
  if (!extractedArchiveDir) {
    throw new Error(`Could not extract "${originalArchive}"`);
  }

  const {
    nestedArchivesResult,
    directChildren,
    wasNested,
  } = await getNestedArchives(
    extractedArchiveDir,
    rootPath || cleanFilePath,
    context,
  );
  let enhancements = {};
  let targetPath = null;
  if (wasNested) {
    targetPath = extractedArchiveDir;
    updatedContext.rootPath = getRootArchivePath(rootPath, cleanFilePath);
    updatedContext.subSagaResults = nestedArchivesResult;
    updatedContext.directChildren = directChildren;
    await cleanUpNestedArchive(updatedContext, extractedArchiveDir, originalArchive);
  } else {
    targetPath = getRootArchivePath(rootPath, newFilePath);
    await validateContents(extractedArchiveDir, originalArchive);
    enhancements = await enhanceArchiveContents(extractedArchiveDir, context);

    const {
      nestedVolumesResult,
      directVolumeChildren,
      wasNestedVolume,
    } = await getNestedVolumes(
      extractedArchiveDir,
      rootPath || cleanFilePath,
      context,
    );
    if (wasNestedVolume) {
      updatedContext.rootPath = getRootArchivePath(rootPath, cleanFilePath);
      updatedContext.subSagaResults = nestedVolumesResult;
      updatedContext.directChildren = directVolumeChildren;
      await cleanUpNestedVolume(
        updatedContext, extractedArchiveDir, archivePath, volumeStartPath,
      );
      deleteIfSuccessful = [];
    } else {
      await zipAndMove(
        extractedArchiveDir,
        cleanFilePath,
        targetPath,
        originalArchive,
      );
    }
  }

  return {
    ...updatedContext,
    archivePath: targetPath,
    originalArchivePath: folderOrArchivePath,
    unexpectedFiles,
    recordChange: true,
    deleteIfSuccessful,
    enhancements,
  };
}

async function convertToCBZBatch(archivePaths, action = CONVERT_TO_CBZ) {
  const results = await getResults(action, archivePaths, convertToCBZ);
  return results;
}

module.exports = {
  convertToCBZ,
  convertToCBZBatch,
  addDirToArchive,
  extractFileFromArchive,
  listArchiveContents,
  actions,
};
