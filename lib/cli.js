const { argv } = require('yargs')(process.argv.slice(2))
  .usage('Usage: $0 --convertToCBZ')
  .demandCommand(1);
const log = require('./logger');
const { getArchives, convertToCBZBatch, startMergeSubFoldersSaga } = require('./archiver');
const {
  getSeries,
  moveIdentifiedSeriesToSeriesFolder,
} = require('./series');
const { setMetaFiles } = require('./meta');
const { getCleanPath } = require('./utils');
const { logSagaResults } = require('./saga');

async function convertToCBZBatchCLI(archivePath) {
  let archives = [];
  try {
    archives = await getArchives(archivePath);
  } catch (err) {
    log.error(err.stack);
  }
  if (!(archives && archives.length)) {
    log.error(`No archive found at ${archivePath}`);
    return;
  }

  const convertToCBZBatchSagaResults = await convertToCBZBatch(archives);
  const mergeSubFoldersSagaResults = await startMergeSubFoldersSaga(convertToCBZBatchSagaResults);
  // log.info(inspect(result));
  // log.error(filteredResults);
  // const setMetaResults = await setMetaFiles(result.successful);
  logSagaResults(convertToCBZBatchSagaResults);
  logSagaResults(mergeSubFoldersSagaResults);
  // logSagaResults(setMetaResults);
}

async function convertToSeriesCLI(archivePath, { seriesFolder }) {
  let archives = [];
  try {
    archives = await getArchives(archivePath, ['cbz']);
  } catch (err) {
    log.error(err.stack);
  }
  if (!(archives && archives.length)) {
    log.error(`No archive found at ${archivePath}`);
    return;
  }

  const identifiedSeriesMetaResults = await getSeries(archives);
  const identified = identifiedSeriesMetaResults.successful;
  const moveResult = await moveIdentifiedSeriesToSeriesFolder(identified, seriesFolder);
  const setMetaResults = await setMetaFiles(moveResult.successful);
  logSagaResults(identifiedSeriesMetaResults);
  logSagaResults(moveResult);
  logSagaResults(setMetaResults);
}

function parseCommands() {
  const argPath = argv._[0];
  const cleanPath = getCleanPath(argPath);

  if (argv.convertToCBZ) {
    convertToCBZBatchCLI(cleanPath);
  } else if (argv.convertToSeries) {
    const seriesFolder = getCleanPath(argv.seriesFolder);
    convertToSeriesCLI(cleanPath, { seriesFolder });
  } else {
    log.error('No command run');
  }
}

module.exports = {
  convertToCBZBatchCLI,
  convertToSeriesCLI,
  parseCommands,
};
