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

async function convertToCBZBatchCLI(archivePath) {
  let archives = [];
  try {
    archives = await getArchives(archivePath);
  } catch (err) {
    log.error(err.stack);
  }
  if (!(archives && archives.length)) {
    log.warn(`No archive found at ${archivePath}`);
    return;
  }

  const convertToCBZBatchSagaResults = await convertToCBZBatch(archives);

  const filteredSubFolderResults = getFilteredOutNested(convertToCBZBatchSagaResults.successful);
  const setMetaResults = await setMetaFiles(filteredSubFolderResults);
  logSagaResults(convertToCBZBatchSagaResults);
  logSagaResults(setMetaResults);
}

async function convertToSeriesCLI(archivePath, cliOptions) {
  const config = await getConfig(cliOptions);

  let archives = [];
  try {
    archives = await getArchives(archivePath, ['cbz']);
  } catch (err) {
    log.error(err.stack);
  }
  if (!(archives && archives.length)) {
    log.warn(`No archive found at ${archivePath}`);
    return;
  }

  const identifiedSeriesMetaResults = await getSeries(archives);
  const identified = identifiedSeriesMetaResults.successful;
  const moveResult = await moveIdentifiedSeriesToSeriesFolder(identified, config.seriesFolder);
  const setMetaResults = await setMetaFiles(moveResult.successful);
  logSagaResults(identifiedSeriesMetaResults);
  logSagaResults(moveResult);
  logSagaResults(setMetaResults);
}

async function getArchivesArrays(queueFolders) {
  const arrays = await Promise.all(
    queueFolders.map(
      async (queueFolder) => getArchives(queueFolder.archivePath, undefined, queueFolder),
    ),
  );
  return Array.prototype.concat(...arrays);
}

async function maintainCollection(cliOptions) {
  const config = await getConfig(cliOptions);
  let archives = [];
  try {
    archives = await getArchivesArrays(config.queueFolders);
  } catch (err) {
    log.error(err.stack);
  }
  if (!(archives && archives.length)) {
    log.warn(`No archive found at ${config.queueFolders}`);
  }
  log.debug(archives)
}

function parseCommands() {
  const argPath = argv._[0];
  const cleanPath = getCleanPath(argPath);

  if (argv.convertToCBZ) {
    convertToCBZBatchCLI(cleanPath);
  } else if (argv.convertToSeries) {
    const seriesFolder = getCleanPath(argv.seriesFolder);
    const configFile = getCleanPath(argv.configFile);
    convertToSeriesCLI(cleanPath, { seriesFolder, configFile });
  } else if (argv.maintainCollection) {
    const configFile = getCleanPath(argv.configFile);
    maintainCollection({ configFile });
  } else {
    log.error('No command run');
  }
}

module.exports = {
  convertToCBZBatchCLI,
  convertToSeriesCLI,
  parseCommands,
};
