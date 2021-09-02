const clone = require('just-clone');
const log = require('./logger');
const {
  getFolderMetaData,
  getFileMetaData,
  removeJunk,
} = require('./seriesFinder');
const { removeEmptyDirs, moveFile } = require('./files');
const { getResults } = require('./saga');
const { getPathData, preferNative, getFilteredOutNested } = require('./utils');
const { getFileFormattedMetaData } = require('./format');

const GET_SERIES_FROM_FILE = 'Identify Series From File';
const IDENTIFY_SERIES = 'Identify Series';
const MOVE_ARCHIVE_TO_SERIES_FOLDER = 'Move Archive to Series Folder';
const actions = {
  GET_SERIES_FROM_FILE,
  IDENTIFY_SERIES,
  MOVE_ARCHIVE_TO_SERIES_FOLDER,
};

function getLocalMetaData(cleanedArchivePath, rootPath, context) {
  const { fileName, dir } = getPathData(cleanedArchivePath);

  let folderMetaData = {};
  const relativeFolder = `${dir}/`.replace(rootPath, '');
  if (relativeFolder) {
    folderMetaData = getFolderMetaData(relativeFolder, context.folderPatterns, context);
  }
  const fileMetaData = getFileMetaData(fileName, context.filePatterns, context);
  const contentMetaData = {
    ...fileMetaData,
    ...folderMetaData,
    ...(context?.contentMetaData || {}),
  };
  if (fileMetaData.volumeNumber !== undefined) {
    contentMetaData.volumeNumber = fileMetaData.volumeNumber;
  }
  if (contentMetaData.seriesName) {
    contentMetaData.seriesName = preferNative(
      folderMetaData.seriesName,
      fileMetaData.seriesName,
      contentMetaData.languageISO,
    );
  }
  return contentMetaData;
}

function getFilePathMetaData(context) {
  const {
    archivePath, queuePath,
  } = context;
  const cleanedArchivePath = removeJunk(archivePath, context.junkToFilter);

  const contentMetaData = getLocalMetaData(cleanedArchivePath, queuePath, context);
  const updatedContext = { ...clone(context), cleanedArchivePath };

  const fileFormattedMetaData = getFileFormattedMetaData(
    contentMetaData,
    updatedContext,
  );

  return {
    ...updatedContext,
    fileFormattedMetaData,
    contentMetaData,
  };
}

async function identifySeriesFromFile(context) {
  const { archivePath } = context;
  log.debug(`Identifying series from "${archivePath}"`);
  const contentContext = getFilePathMetaData(context);
  log.debug(`Identified "${archivePath}" as "${contentContext.contentMetaData.seriesName}"`);
  return {
    ...context,
    ...contentContext,

    action: GET_SERIES_FROM_FILE,
    recordChange: false,
  };
}

async function moveArchiveToSeriesFolder(archivePath, outputFilePath) {
  // const seriesFolder = `${baseSeriesFolder || dir}/${seriesName}/`;
  // const outputFilePath = getOutputFilePath(contentMetaData,);

  // const newArchivePath = `${outputFilePath}${fileName}${ext}`;
  if (archivePath !== outputFilePath) {
    log.info(`Moving content to "${outputFilePath}"`);
    await moveFile(archivePath, outputFilePath);
  } else {
    log.info(`Archive already exists in the correct Series Folder: "${outputFilePath}"`);
  }

  return outputFilePath;
}

async function cleanQueues(contexts) {
  if (!contexts) {
    return true;
  }
  const allQueues = contexts.map(({ queuePath }) => queuePath);
  const uniqueQueues = [...new Set(allQueues)];

  return Promise.all(
    uniqueQueues.map(
      async (queuePath) => removeEmptyDirs(queuePath, queuePath),
    ),
  );
}

async function moveIdentifiedSeriesToSeriesFolder(identifiedContext) {
  async function getResult(context) {
    const { archivePath, fileFormattedMetaData: { outputFilePath }, queuePath } = context;

    const newArchivePath = await moveArchiveToSeriesFolder(archivePath, outputFilePath, queuePath);
    return {
      ...context,
      archivePath: newArchivePath,
      originalArchivePath: archivePath,
      action: MOVE_ARCHIVE_TO_SERIES_FOLDER,
      recordChange: archivePath !== newArchivePath,
    };
  }
  const results = await getResults(MOVE_ARCHIVE_TO_SERIES_FOLDER, identifiedContext, getResult);
  await cleanQueues(results.successful);
  return results;
}

function logSuggestedSeries(contexts) {
  contexts.forEach((context) => {
    const {
      archivePath, fileFormattedMetaData, seriesRoot, queuePath,
    } = context;

    const { outputFilePath } = fileFormattedMetaData;
    const originalRelativeArchivePath = archivePath.replace(queuePath, '');
    const relativeArchivePath = outputFilePath.replace(seriesRoot, '');
    log.info(`Suggesting to rename:
     "${queuePath}" -> "${seriesRoot}"
     "${originalRelativeArchivePath}" to
     "${relativeArchivePath}"`);
    // log.debug(`Based on:\n"${inspect(contentMetaData)}"`);
  });
}

async function getSeries(archivePaths) {
  async function onFail(context) {
    return { archivePath: context.archivePath };
  }
  const nonNestedArchives = getFilteredOutNested(archivePaths);
  const results = await getResults(
    IDENTIFY_SERIES,
    nonNestedArchives,
    identifySeriesFromFile,
    onFail,
  );
  logSuggestedSeries(results.successful);
  return results;
}

module.exports = {
  moveIdentifiedSeriesToSeriesFolder,
  identifySeriesFromFile,
  getSeries,
  actions,
};
