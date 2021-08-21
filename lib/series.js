const fs = require('fs');
const log = require('./logger');
const seriesFinder = require('./seriesFinder');
const { removeAllEmptyDirs } = require('./files');
const {
  getPathData,
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
  const successful = [];
  const unsuccessful = [];
  async function callback(metaData) {
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
  await Promise.all(identifiedMetaData.map(callback));
  return {
    successful,
    unsuccessful,
  };
}

async function getSeries(archivePaths) {
  const successful = [];
  const unsuccessful = [];
  async function callback(archivePath) {
    try {
      const identifySeries = await identifySeriesFromFile(archivePath);
      successful.push(identifySeries);
    } catch (error) {
      unsuccessful.push({ error, metaData: { archivePath } });
    }
  }
  await Promise.all(archivePaths.map(callback));
  return {
    successful,
    unsuccessful,
  };
}

module.exports = {
  moveIdentifiedSeriesToSeriesFolder,
  identifySeriesFromFile,
  getSeries,
};
