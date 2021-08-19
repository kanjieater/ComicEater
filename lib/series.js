const fs = require('fs');
const seriesFinder = require('./seriesFinder');
const { removeAllEmptyDirs } = require('./files');
const { log } = require('./logger');
const {
  getPathData,
} = require('./utils');

async function moveFile(from, to) {
  log(`Moving "${from}" to "${to}"`, 'info');
  return fs.promises.rename(from, to);
}

async function identifySeriesFromFile(archivePath) {
  const { fileName } = getPathData(archivePath);
  log(`Identifying series from "${archivePath}"`);
  const seriesName = seriesFinder.find(fileName);
  log(`Identified "${archivePath}" as "${seriesName}"`);
  return { seriesName, archivePath };
}

async function moveAnIdentifiedSeriesToSeriesFolder({ seriesName, archivePath }, baseSeriesFolder) {
  const { fileName, ext, dir } = getPathData(archivePath);

  const seriesFolder = `${baseSeriesFolder || dir}/${seriesName}/`;
  log(`Creating series folder "${seriesFolder}"`, 'info');
  await fs.promises.mkdir(seriesFolder, { recursive: true });

  const newArchivePath = `${seriesFolder}${fileName}${ext}`;
  await moveFile(archivePath, newArchivePath);
  await removeAllEmptyDirs(dir);
  return newArchivePath;
}

async function moveIdentifiedSeriesToSeriesFolder(identifiedSeries, baseSeriesFolder) {
  const identified = [];
  const unidentifed = [];

  await Promise.all(identifiedSeries.map(
    async (anIdentifiedSeries) => {
      const p = moveAnIdentifiedSeriesToSeriesFolder(anIdentifiedSeries, baseSeriesFolder);
      return p
        .then((newArchivePath) => identified.push(newArchivePath))
        .catch((error) => unidentifed.push({ error, identifiedSeries }));
    },
  ));

  let failedMessage = '';
  unidentifed.forEach(({ error, archivePath }, index) => {
    failedMessage += `Failed converting ${index + 1}/${unidentifed.length} "${archivePath}" because of: ${error}\n`;
  });
  log(`Archives moved to Series folder: ${identified.length}.
  Failed: ${unidentifed.length} 
  ${failedMessage}`, 'info');
  return identified;
}

async function getSeries(archivePaths) {
  const identified = [];
  const unidentifed = [];

  await Promise.all(archivePaths.map(
    async (archivePath) => identifySeriesFromFile(archivePath)
      .then((identifySeries) => identified.push(identifySeries))
      .catch((error) => unidentifed.push({ error, archivePath })),
  ));

  let failedMessage = '';
  unidentifed.forEach(({ error, archivePath }, index) => {
    failedMessage += `Failed converting ${index + 1}/${unidentifed.length} "${archivePath}" because of: ${error}\n`;
  });
  log(`Series identified: ${identified.length}.
  Failed: ${unidentifed.length} 
  ${failedMessage}`, 'info');
  return identified;
}

module.exports = {
  moveIdentifiedSeriesToSeriesFolder,
  identifySeriesFromFile,
  getSeries,
};
