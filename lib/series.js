const fs = require('fs');
const log = require('./logger');
const {
  getFolderMetaData,
  getFileMetaData,
  removeJunk,
} = require('./seriesFinder');
const { removeAllEmptyDirs, moveFile } = require('./files');
const { getResults } = require('./saga');
const { getPathData, zeroPad, inspect } = require('./utils');

const GET_SERIES_FROM_FILE = 'Identify Series From File';
const IDENTIFY_SERIES = 'Identify Series';
const MOVE_ARCHIVE_TO_SERIES_FOLDER = 'Move Archive to Series Folder';
const actions = {
  GET_SERIES_FROM_FILE,
  IDENTIFY_SERIES,
  MOVE_ARCHIVE_TO_SERIES_FOLDER,
};

function getFilePathMetaData(context) {
  const { archivePath, queuePath } = context;
  const cleanedArchivePath = removeJunk(archivePath, context.junkToFilter);
  const { fileName, dir } = getPathData(cleanedArchivePath);

  let folderMetaData = {};
  const relativeFolder = `${dir}/`.replace(queuePath, '');
  if (relativeFolder) {
    folderMetaData = getFolderMetaData(relativeFolder, context.folderPatterns);
  }
  const fileMetaData = getFileMetaData(fileName, context.filePatterns);
  const contentMetaData = {
    ...fileMetaData,
    ...folderMetaData,
  };
  if (fileMetaData.volumeNumber !== undefined) {
    contentMetaData.volumeNumber = fileMetaData.volumeNumber;
    contentMetaData.formattedVolumeNumber = zeroPad(fileMetaData.volumeNumber, 2);
  }
  return {
    ...context,
    contentMetaData,
    cleanedArchivePath,
  };
}

async function identifySeriesFromFile(context) {
  const { archivePath } = context;
  const { fileName, dir } = getPathData(archivePath);
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

function applyTemplate(template, data) {
  let output = template;
  const templateRegex = /{{(.*?)}}/g;
  const allMatches = Array.from(template.matchAll(templateRegex));
  const allKeys = allMatches.map(([, key]) => key);
  const uniqueTemplateKeys = [...new Set(allKeys)];
  const matched = uniqueTemplateKeys.every((key) => {
    const variableRegex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    const hasKey = Object.prototype.hasOwnProperty.call(data, key);
    if (variableRegex.test(output) && hasKey) {
      output = output.replace(variableRegex, data[key]);
      return true;
    }
    return false;
  });

  return matched ? output : false;
}

function getOutputFilePath(
  outputNamingConventions,
  contentMetaData,
  seriesRoot,
  cleanedArchivePath,
) {
  let outputFilePath = false;
  const { fileName, ext } = getPathData(cleanedArchivePath);
  outputNamingConventions.find((outputNamingConvention) => {
    outputFilePath = applyTemplate(
      outputNamingConvention,
      {
        ...contentMetaData,
        seriesRoot,
        fileName,
      },
    );
    return outputFilePath;
  });
  if (!outputFilePath) {
    throw new Error(`A matching output naming convention wasn't found for: "${cleanedArchivePath}"`);
  }
  return `${outputFilePath}${ext}`;
}

async function moveArchiveToSeriesFolder(archivePath, outputFilePath) {
  // const seriesFolder = `${baseSeriesFolder || dir}/${seriesName}/`;
  // const outputFilePath = getOutputFilePath(contentMetaData,);
  const { dir: seriesFolder } = getPathData(outputFilePath);

  // const newArchivePath = `${outputFilePath}${fileName}${ext}`;
  if (archivePath !== outputFilePath) {
    log.info(`Creating series folder "${seriesFolder}"`);
    await fs.promises.mkdir(seriesFolder, { recursive: true });
    await moveFile(archivePath, outputFilePath);
    await removeAllEmptyDirs(seriesFolder);
  } else {
    log.info(`Archive already exists in the correct Series Folder: "${outputFilePath}"`);
  }

  return outputFilePath;
}

async function moveIdentifiedSeriesToSeriesFolder(identifiedContext, seriesRoot) {
  async function getResult(context) {
    const { metaData, archivePath } = context;
    const outputFilePath = getOutputFilePath(identifiedContext.contentMetaData, seriesRoot);
    const newArchivePath = await moveArchiveToSeriesFolder(archivePath, outputFilePath);
    return {
      ...context,
      metaData,
      archivePath: newArchivePath,
      originalArchivePath: archivePath,
      action: MOVE_ARCHIVE_TO_SERIES_FOLDER,
      recordChange: archivePath !== newArchivePath,
    };
  }

  return getResults(MOVE_ARCHIVE_TO_SERIES_FOLDER, identifiedContext, getResult);
}

function logSuggestedSeries(contexts) {
  contexts.forEach(({
    archivePath,
    contentMetaData,
    seriesRoot,
    queuePath,
    outputNamingConventions,
    cleanedArchivePath,
  }) => {
    const outputFilePath = getOutputFilePath(
      outputNamingConventions,
      contentMetaData,
      seriesRoot,
      cleanedArchivePath,
    );
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
  const results = await getResults(IDENTIFY_SERIES, archivePaths, identifySeriesFromFile, onFail);
  logSuggestedSeries(results.successful);
  return results;
}

module.exports = {
  moveIdentifiedSeriesToSeriesFolder,
  identifySeriesFromFile,
  getSeries,
  getOutputFilePath,
  actions,
};
