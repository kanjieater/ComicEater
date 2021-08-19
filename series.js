const fs = require('fs');

const {
  log, getPathData,
} = require('./utils');

async function moveFile(from, to) {
  log(`Moving "${from}" to "${to}"`, 'info');
  return fs.promises.rename(from, to);
}

function getSeriesName() {
  return 'test';
}

async function identifySeriesFromFile(archivePath) {
  // const { fileName, ext, dir } = getPathData(archivePath);
  log(`Identifying series from "${archivePath}"`);
  const seriesName = getSeriesName(archivePath);
  log(`Identified "${archivePath}" as "${seriesName}"`);
  return { seriesName, archivePath };
}

async function moveAnIdentifiedSeriesToSeriesFolder({ seriesName, archivePath }, baseSeriesFolder) {
  const { fileName, ext, dir } = getPathData(archivePath);

  const seriesFolder = `${baseSeriesFolder || dir}/${seriesName}/`;
  log(`Creating series folder "${seriesFolder}"`, 'info');
  await fs.promises.mkdir(seriesFolder, { recursive: true });

  const newArchivePath = `${seriesFolder}${fileName}${ext}`;
  moveFile(archivePath, newArchivePath);
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
  // const isFile = await checkIsFile(startPath);
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
  // const isFile = await checkIsFile(startPath);
  return identified;
}

module.exports = {
  moveIdentifiedSeriesToSeriesFolder,
  identifySeriesFromFile,
  getSeries,
};
