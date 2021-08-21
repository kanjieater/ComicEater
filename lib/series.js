const fs = require('fs');
const log = require('./logger');
const seriesFinder = require('./seriesFinder');
const { removeAllEmptyDirs } = require('./files');
const { getResults } = require('./saga');
const { getPathData } = require('./utils');

const GET_SERIES_FROM_FILE = 'Identify Series From File';
const IDENTIFY_SERIES = 'Identify Series';
const MOVE_ARCHIVE_TO_SERIES_FOLDER = 'Move Archive to Series Folder';
const actions = {
  GET_SERIES_FROM_FILE,
  IDENTIFY_SERIES,
  MOVE_ARCHIVE_TO_SERIES_FOLDER,
};

async function moveFile(from, to) {
  log.info(`Moving "${from}" to "${to}"`);
  return fs.promises.rename(from, to);
}

async function identifySeriesFromFile({ archivePath }) {
  const { fileName } = getPathData(archivePath);
  log.debug(`Identifying series from "${archivePath}"`);
  const { seriesName, volumeNumber, hasVolumeNumber } = seriesFinder.find(fileName);
  log.debug(`Identified "${archivePath}" as "${seriesName}"`);
  return {
    metaData: {
      seriesName,
      volumeNumber,
    },
    hasVolumeNumber,
    archivePath,
    action: GET_SERIES_FROM_FILE,
    recordChange: false,
  };
}

async function moveArchiveToSeriesFolder(seriesName, archivePath, baseSeriesFolder) {
  const { fileName, ext, dir } = getPathData(archivePath);

  const seriesFolder = `${baseSeriesFolder || dir}/${seriesName}/`;
  log.info(`Creating series folder "${seriesFolder}"`);

  await fs.promises.mkdir(seriesFolder, { recursive: true });

  const newArchivePath = `${seriesFolder}${fileName}${ext}`;
  await moveFile(archivePath, newArchivePath);
  await removeAllEmptyDirs(dir);
  return newArchivePath;
}

async function moveIdentifiedSeriesToSeriesFolder(identifiedMetaData, baseSeriesFolder) {
  async function getResult(context) {
    const { metaData, archivePath } = context;
    const newArchivePath = await moveArchiveToSeriesFolder(
      metaData.seriesName,
      archivePath,
      baseSeriesFolder,
    );
    return {
      ...context,
      metaData,
      archivePath: newArchivePath,
      originalArchivePath: archivePath,
      action: MOVE_ARCHIVE_TO_SERIES_FOLDER,
      recordChange: true,
    };
  }

  return getResults(MOVE_ARCHIVE_TO_SERIES_FOLDER, identifiedMetaData, getResult);
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
  actions,
};
