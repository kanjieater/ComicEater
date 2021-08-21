const fs = require('fs');
const log = require('./logger');
const seriesFinder = require('./seriesFinder');
const { removeAllEmptyDirs } = require('./files');
const {
  getPathData, getResults,
} = require('./utils');

async function moveFile(from, to) {
  log.info(`Moving "${from}" to "${to}"`);
  return fs.promises.rename(from, to);
}

async function identifySeriesFromFile(archivePath) {
  const { fileName } = getPathData(archivePath);
  log.debug(`Identifying series from "${archivePath}"`);
  const { seriesName, volumeNumber, hasVolumeNumber } = seriesFinder.find(fileName);
  log.debug(`Identified "${archivePath}" as "${seriesName}"`);
  return {
    seriesName, archivePath, volumeNumber, hasVolumeNumber,
  };
}

async function moveArchiveToSeriesFolder({ seriesName, archivePath }, baseSeriesFolder) {
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
  async function callback(metaData, successful, unsuccessful) {
    try {
      const newArchivePath = await moveArchiveToSeriesFolder(metaData, baseSeriesFolder);
      successful.push({
        ...metaData,
        archivePath: newArchivePath,
        originalArchivePath: metaData.archivePath,
      });
    } catch (error) {
      unsuccessful.push({ error, metaData });
    }
  }
  return getResults(identifiedMetaData, callback);
}

async function getSeries(archivePaths) {
  async function callback(archivePath, successful, unsuccessful) {
    try {
      const identifySeries = await identifySeriesFromFile(archivePath);
      successful.push(identifySeries);
    } catch (error) {
      unsuccessful.push({ error, metaData: { archivePath } });
    }
  }
  return getResults(archivePaths, callback);
}
module.exports = {
  moveIdentifiedSeriesToSeriesFolder,
  identifySeriesFromFile,
  getSeries,
};
