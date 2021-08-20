const fs = require('fs');
const seriesFinder = require('./seriesFinder');
const { removeAllEmptyDirs } = require('./files');
const { log } = require('./logger');
const {
  getPathData,
} = require('./utils');
const { setMetaFile } = require('./meta');

async function moveFile(from, to) {
  log(`Moving "${from}" to "${to}"`, 'info');
  return fs.promises.rename(from, to);
}

async function identifySeriesFromFile(archivePath) {
  const { fileName } = getPathData(archivePath);
  log(`Identifying series from "${archivePath}"`);
  const { seriesName, volumeNumber, hasVolumeNumber } = seriesFinder.find(fileName);
  log(`Identified "${archivePath}" as "${seriesName}"`);
  return {
    seriesName, archivePath, volumeNumber, hasVolumeNumber,
  };
}

async function moveArchiveToSeriesFolder({ seriesName, archivePath }, baseSeriesFolder) {
  const { fileName, ext, dir } = getPathData(archivePath);

  const seriesFolder = `${baseSeriesFolder || dir}/${seriesName}/`;
  log(`Creating series folder "${seriesFolder}"`, 'info');

  await fs.promises.mkdir(seriesFolder, { recursive: true });

  const newArchivePath = `${seriesFolder}${fileName}${ext}`;
  await moveFile(archivePath, newArchivePath);
  await removeAllEmptyDirs(dir);
  return newArchivePath;
}

async function moveIdentifiedSeriesToSeriesFolder(identifiedMetaData, baseSeriesFolder) {
  const identified = [];
  const unidentified = [];
  async function callback(metaData) {
    try {
      const newArchivePath = await moveArchiveToSeriesFolder(metaData, baseSeriesFolder);
      identified.push(newArchivePath);
      await setMetaFile(newArchivePath, {}, 'Moved Archive');
    } catch (error) {
      unidentified.push({ error, metaData });
    }
  }
  await Promise.all(identifiedMetaData.map(callback));

  let failedMessage = '';
  unidentified.forEach(({ error, metaData }, index) => {
    failedMessage += `Failed converting ${index + 1}/${unidentified.length} "${metaData.archivePath}" because of: ${error.stack || error}\n`;
  });
  log(`Archives moved to Series folder: ${identified.length}.
  Failed: ${unidentified.length}
  ${failedMessage}`, 'info');
  return identified;
}

async function getSeries(archivePaths) {
  const identified = [];
  const unidentified = [];

  await Promise.all(archivePaths.map(
    async (archivePath) => identifySeriesFromFile(archivePath)
      .then((identifySeries) => identified.push(identifySeries))
      .catch((error) => unidentified.push({ error, archivePath })),
  ));

  let failedMessage = '';
  unidentified.forEach(({ error, archivePath }, index) => {
    failedMessage += `Failed converting ${index + 1}/${unidentified.length} "${archivePath}" because of: ${error}\n`;
  });
  log(`Series identified: ${identified.length}.
  Failed: ${unidentified.length}
  ${failedMessage}`, 'info');
  return identified;
}

module.exports = {
  moveIdentifiedSeriesToSeriesFolder,
  identifySeriesFromFile,
  getSeries,
};
