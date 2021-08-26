const { argv } = require('yargs')(process.argv.slice(2))
  .usage('Usage: $0 --convertToCBZ');
  // .demandCommand(1);

const log = require('./logger');
const {
  getArchives,
  convertToCBZBatch,
  getFilteredOutNested,
} = require('./archiver');
const {
  getSeries,
  moveIdentifiedSeriesToSeriesFolder,
} = require('./series');

const { setMetaFiles } = require('./meta');
const { getCleanPath } = require('./utils');
const { logSagaResults } = require('./saga');
const { getConfig } = require('./config');

async function getArchivesCLI(archivePath, extensions) {
  let archives = [];
  try {
    archives = await getArchives(archivePath, extensions);
  } catch (err) {
    log.error(err.stack);
  }
  if (!(archives && archives.length)) {
    log.warn(`No archive found at ${archivePath}`);
    return [];
  }
  return archives;
}

function logAllResults(allResults) {
  allResults.forEach(() => {
    logSagaResults();
  });
}

async function setMetaData(sagaResults) {
  const filteredSubFolderResults = getFilteredOutNested(sagaResults.successful);
  const setMetaResults = await setMetaFiles(filteredSubFolderResults);
  return [setMetaResults];
}

async function convertToCBZBatchCLI(archives) {
  const convertToCBZBatchSagaResults = await convertToCBZBatch(archives);
  return [convertToCBZBatchSagaResults];
}

async function convertToSeriesCLI(archives, config) {
  const identifiedSeriesMetaResults = await getSeries(archives);
  const identified = identifiedSeriesMetaResults.successful;
  const moveResult = await moveIdentifiedSeriesToSeriesFolder(identified, config.seriesFolder);
  return [identifiedSeriesMetaResults, moveResult];
}

async function getArchivesArrays(queueFolders) {
  const arrays = await Promise.all(
    queueFolders.map(
      async (queueFolder) => getArchives(queueFolder.archivePath, undefined, queueFolder),
    ),
  );
  return Array.prototype.concat(...arrays);
}

async function maintainCollection(config) {
  let archives = [];
  try {
    archives = await getArchivesArrays(config.queueFolders);
  } catch (err) {
    log.error(err.stack);
  }
  if (!(archives && archives.length)) {
    log.warn(`No archive found at ${config.queueFolders}`);
  }
  log.debug(archives);
  let allResults = await convertToCBZBatchCLI(archives);
  const allCBZResults = allResults[allResults.length - 1].successful;
  allResults = allResults.concat(await convertToSeriesCLI(allCBZResults, config));
  return allResults;
}

async function parseCommands() {
  const argPath = argv._[0];
  const cleanArchivePath = getCleanPath(argPath);
  let allResults = [];
  let runMeta = true;
  if (argv.convertToCBZ) {
    const archives = await getArchivesCLI(cleanArchivePath);
    allResults = await convertToCBZBatchCLI(archives);
  } else if (argv.convertToSeries) {
    const seriesFolder = getCleanPath(argv.seriesFolder);
    const configFile = getCleanPath(argv.configFile);
    const cliOptions = { seriesFolder, configFile };
    const [archives, config] = await Promise.all([
      getConfig(cliOptions),
      getArchivesCLI(cleanArchivePath, ['cbz']),
    ]);
    allResults = await convertToSeriesCLI(archives, config);
  } else if (argv.maintainCollection) {
    const configFile = getCleanPath(argv.configFile);
    const config = await getConfig({ configFile });
    allResults = await maintainCollection(config);
  } else {
    log.error('No command run');
    runMeta = false;
  }

  if (runMeta) {
    const [finalResult] = allResults.slice(-1);
    allResults = allResults.concat(await setMetaData(finalResult));
    logAllResults(allResults);
  }
}

module.exports = {
  convertToCBZBatchCLI,
  convertToSeriesCLI,
  parseCommands,
};
