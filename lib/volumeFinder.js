const clone = require('just-clone');
const log = require('./logger');
const { getImages, verifyImageCount } = require('./image');
const {
  removeEmptyDirs, getChildDirs, rm,
} = require('./files');
const { getResults, logSagaResults, SubSagaError } = require('./saga');

const {
  getPathData, getFilteredOutNested, inspect,
} = require('./utils');

const {
  zipAndMove, getNewFilePath, getArchives, validateImagesExist,
} = require('./command');
const { getFileMetaData } = require('./seriesFinder');

const CONVERT_FOLDER_TO_CBZ = 'Convert Image Folder to CBZ';
const FIND_NESTED_VOLUMES = 'Find Individual Volumes in Volume Range';

function getContentMetaData(volumeStartPath, context) {
  const { fileName } = getPathData(volumeStartPath);
  return getFileMetaData(fileName, context.filePatterns, context);
}

function isInRange(min, max, input) {
  return input >= min && input <= max;
}

function getMinAndMax(volumeRange) {
  return {
    min: volumeRange[0].volumeNumber,
    max: volumeRange[volumeRange.length - 1].volumeNumber,
  };
}

function isIncludedAlready(volumeSet, newVolumeNumber, newVolumeVariant = '') {
  let isIncluded = false;
  volumeSet.forEach(({ volumeNumber, volumeVariant }) => {
    const volumesMatch = volumeNumber === newVolumeNumber;
    if (volumesMatch) {
      if (newVolumeNumber) {
        if (newVolumeVariant === volumeVariant) {
          isIncluded = true;
        }
      } else {
        isIncluded = false;
      }
    } else {
      isIncluded = false;
    }
  });
  return isIncluded;
}

function getVolumeSet(filteredSubFolderResults, min, max) {
  const volumeSet = [];
  filteredSubFolderResults.forEach((nestedContext) => {
    const { volumeNumber, volumeVariant } = nestedContext.contentMetaData;
    if (isInRange(min, max, volumeNumber)) {
      if (volumeVariant && !isIncludedAlready(volumeSet, volumeNumber, volumeVariant)) {
        volumeSet.push(nestedContext);
      } else if (!isIncludedAlready(volumeSet, volumeNumber)) {
        volumeSet.push(nestedContext);
      }
    }
  });
  return volumeSet.sort((a, b) => a.contentMetaData.volumeNumber - b.contentMetaData.volumeNumber);
}

function getResultsInRange(results, context) {
  if (!context.contentMetaData.volumeRange) {
    return getFilteredOutNested(results.successful)
      .map((c) => ({
        ...c,
        deleteIfSuccessful: [c.extractedArchiveDir],
      }));
  }
  const filteredSubFolderResults = getFilteredOutNested(results.successful);
  const { min, max } = getMinAndMax(context.contentMetaData.volumeRange);
  const volumeSet = getVolumeSet(filteredSubFolderResults, min, max);
  const uniqueNumbers = [
    ...new Set(volumeSet.map(({ contentMetaData }) => contentMetaData.volumeNumber)),
  ];
  let rangeCount = min;
  uniqueNumbers.forEach((volumeNumber) => {
    const matchesRange = rangeCount === volumeNumber;
    if (matchesRange) {
      rangeCount += 1;
    }
  });

  if (rangeCount - 1 !== max) {
    return [];
  }
  return volumeSet;
}

function cleanNestedFoldersResults(results, context) {
  if (context.subSagaResults.unsuccessful.length !== 0) {
    throw new SubSagaError(
      `Child volume folder failed so the parent volume folder failed as well. ${context.volumeStartPath}`,
      context.subSagaResults,
    );
  }
  const updatedContext = clone(context);
  updatedContext.subSagaResults.successful = getResultsInRange(results, context);
  return updatedContext;
}

async function getNestedFolder(context) {
  const { volumeStartPath } = context;
  const childDirs = await getChildDirs(volumeStartPath);
  const updatedContext = {
    ...clone(context),
    action: CONVERT_FOLDER_TO_CBZ,
    recordChange: false,
  };

  delete updatedContext.contentMetaData.volumeNumber;
  delete updatedContext.contentMetaData.volumeRange;
  delete updatedContext.contentMetaData.volumeVariant;
  const updatedContentMetaData = getContentMetaData(volumeStartPath, context);
  updatedContext.contentMetaData = {
    ...updatedContext.contentMetaData,
    ...updatedContentMetaData,
  };
  const contentExists = await validateImagesExist(volumeStartPath);
  if ((
    childDirs.length === 0 && updatedContext.contentMetaData.volumeNumber === undefined
  ) || !contentExists
  ) {
    return updatedContext;
  }

  if (updatedContext.contentMetaData.volumeRange) {
    log.debug(`A volumeRange was found in "${volumeStartPath}"`);
    // eslint-disable-next-line no-use-before-define
    const subFolderResults = await getNestedFoldersSaga(childDirs, updatedContext);
    updatedContext.subSagaResults = subFolderResults;
    updatedContext.directChildren = childDirs;
    const cleanedContext = cleanNestedFoldersResults(subFolderResults, updatedContext);
    return {
      ...cleanedContext,
    };
  }

  if (updatedContext.contentMetaData.volumeNumber !== undefined) {
    log.debug(`A single volume was found in "${volumeStartPath}"`);
    return {
      ...updatedContext,
      extractedArchiveDir: volumeStartPath,
    };
  }

  // Have subfolders but didn't identify volumes
  // eslint-disable-next-line no-use-before-define
  const subFolderResults = await getNestedFoldersSaga(childDirs, context);
  updatedContext.subSagaResults = subFolderResults;
  updatedContext.directChildren = childDirs;
  const cleanedContext = cleanNestedFoldersResults(subFolderResults, updatedContext, childDirs);
  return {
    ...cleanedContext,
  };
}

async function getNestedFoldersSaga(volumeStartPaths, context) {
  const arrContext = volumeStartPaths.map((volumeStartPath) => ({
    ...clone(context),
    volumeStartPath,
  }));
  const results = await getResults(FIND_NESTED_VOLUMES, arrContext, getNestedFolder);
  logSagaResults(results);
  return results;
}

async function getVolumes(volumeStartPath, context) {
  const contentMetaData = getContentMetaData(volumeStartPath, context);

  if (!contentMetaData.volumeRange && !context?.volumeStartPath) {
    return [];
  }
  const updatedContext = {
    ...clone(context),
    contentMetaData,
  };
  const results = await getNestedFoldersSaga(
    [volumeStartPath],
    updatedContext,
  );
  const hasValidImageCount = await verifyImageCount(results.successful);
  if (!hasValidImageCount) {
    log.info(`Image count did not match after attempting to split "${volumeStartPath}"`);
    return [];
  }
  const successfulInRange = getResultsInRange(results, updatedContext);
  const successfulWithPaths = successfulInRange
    .filter((nestedContext) => nestedContext.extractedArchiveDir)
    .map((nestedContext) => ({
      ...nestedContext,
      volumeStartPath,
      targetPath: getNewFilePath(nestedContext.extractedArchiveDir, 'cbz'),
    }));
  return successfulWithPaths;
}

async function convertFolderToCBZ(context) {
  const { extractedArchiveDir, targetPath } = context;
  await zipAndMove(
    extractedArchiveDir, // subfolder where images are
    targetPath, // archive to put things in to start with
    targetPath, // archive to move things to
  );
  return {
    ...context,
    archivePath: targetPath,
    action: CONVERT_FOLDER_TO_CBZ,
    recordChange: true,
  };
}

async function convertFoldersToCBZBatch(folderPaths) {
  const results = await getResults(CONVERT_FOLDER_TO_CBZ, folderPaths, convertFolderToCBZ);
  return results;
}

async function startNestedVolumesSaga(volumePaths) {
  log.debug(`${volumePaths.length} nested volumes found in: "${volumePaths}\n ${inspect(volumePaths)}"`);
  // eslint-disable-next-line no-use-before-define
  const results = await convertFoldersToCBZBatch(volumePaths);
  logSagaResults(results);
  return results;
}

async function getNestedVolumesPaths(extractedArchiveDir, rootPath, context) {
  log.debug(`Checking for nested volumes in: "${extractedArchiveDir}"`);
  const volumePaths = await getVolumes(extractedArchiveDir, context);
  const updatedVolumePaths = volumePaths.map((volumeContext) => ({
    ...context,
    ...volumeContext,
    rootPath,
  }));
  return updatedVolumePaths;
}

async function getNestedVolumes(extractedArchiveDir, rootPath, context) {
  const nestedVolumes = await getNestedVolumesPaths(extractedArchiveDir, rootPath, context);
  let wasNested = true;
  let nestedVolumesResult;
  if (nestedVolumes.length >= 1) {
    nestedVolumesResult = await startNestedVolumesSaga(nestedVolumes);
  } else {
    log.debug(`No nested volumes found in: "${extractedArchiveDir}"`);
    wasNested = false;
  }
  return {
    nestedVolumesResult,
    directVolumeChildren: nestedVolumes,
    wasNestedVolume: wasNested,
  };
}

async function cleanUpNestedVolume(context, extractedArchiveDir, originalArchive, volumeStartPath) {
  if (context.subSagaResults.unsuccessful.length !== 0) {
    throw new SubSagaError(
      `Child volume failed so the parent folder will not be removed. ${context.archivePath}`,
      context.subSagaResults,
    );
  }
  const { ext } = getPathData(originalArchive);
  if (ext) {
    await rm(originalArchive, false);
  }
  await removeEmptyDirs(volumeStartPath);
  await removeEmptyDirs(extractedArchiveDir);
}

async function getVolumeStartPaths(startPath, context = {}) {
  const childDirs = await getChildDirs(startPath);
  const validChildPaths = await Promise.all(childDirs.map(async (childDir) => {
    const allImages = await getImages(childDir);
    const hasImages = !!(allImages.length);

    if (hasImages) {
      const hasArchives = !!((await getArchives(childDir)).length);
      if (!hasArchives) {
        return childDir;
      }
    }
    return null;
  }));
  const volumeStartPaths = [].concat(...validChildPaths)
    .filter((volumeStartPath) => volumeStartPath);

  return volumeStartPaths.map(
    (volumeStartPath) => ({ ...context, archivePath: volumeStartPath, volumeStartPath }),
  );
}

module.exports = {
  getNestedVolumes,
  cleanUpNestedVolume,
  getVolumes,
  getVolumeStartPaths,
};
