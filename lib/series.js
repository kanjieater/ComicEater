const fs = require('fs');
const log = require('./logger');
const {
  getFilteredPaths,
  getFolderMetaData,
  getFileMetaData,
} = require('./seriesFinder');
const { removeAllEmptyDirs, moveFile } = require('./files');
const { getResults } = require('./saga');
const { getPathData, zeroPad } = require('./utils');

const GET_SERIES_FROM_FILE = 'Identify Series From File';
const IDENTIFY_SERIES = 'Identify Series';
const MOVE_ARCHIVE_TO_SERIES_FOLDER = 'Move Archive to Series Folder';
const actions = {
  GET_SERIES_FROM_FILE,
  IDENTIFY_SERIES,
  MOVE_ARCHIVE_TO_SERIES_FOLDER,
};

function getFilePathMetaData(context) {
  const { archivePath } = context;
  const junkFilteredArchivePath = getFilteredPaths(archivePath);
  const { fileName } = getPathData(junkFilteredArchivePath);
  const folderMetaData = getFolderMetaData(junkFilteredArchivePath, context.folderPatterns);
  const fileMetaData = getFileMetaData(junkFilteredArchivePath, context.filePatterns);
  return {
    ...context,
    ...fileMetaData,
    ...folderMetaData,
    archiveFileName: fileName,
  };
}

async function identifySeriesFromFile(context) {
  const { archivePath } = context;
  const { fileName, dir } = getPathData(archivePath);
  log.debug(`Identifying series from "${archivePath}"`);
  const contentMetaData = getFilePathMetaData(context);
  log.debug(`Identified "${archivePath}" as "${contentMetaData.seriesName}"`);
  return {
    ...context,
    ...contentMetaData,

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
    if (variableRegex.test(output)) {
      output = output.replace(variableRegex, data[key]);
      return true;
    }
    return false;
  });

  return matched ? output : false;
}

function getOutputFilePath(outputNamingConventions, contentMetaData, root, archiveFileName) {
  let outputFilePath = false;
  outputNamingConventions.find((outputNamingConvention) => {
    outputFilePath = applyTemplate(
      outputNamingConvention,
      {
        ...contentMetaData,
        root,
        archiveFileName,
      },
    );
    return outputFilePath;
  });
  if (outputFilePath) {
    const { ext } = getPathData(archiveFileName);
    outputFilePath = `${outputFilePath}${ext}`;
  }
  return outputFilePath || false;
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

async function moveIdentifiedSeriesToSeriesFolder(identifiedContext, root) {
  async function getResult(context) {
    const { metaData, archivePath } = context;
    const outputFilePath = getOutputFilePath(identifiedContext.contentMetaData, root);
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

async function getSeries(archivePaths) {
  async function onFail(context) {
    return { archivePath: context.archivePath };
  }
  return getResults(IDENTIFY_SERIES, archivePaths, identifySeriesFromFile, onFail);
}

module.exports = {
  moveIdentifiedSeriesToSeriesFolder,
  identifySeriesFromFile,
  getSeries,
  getOutputFilePath,
  actions,
};
