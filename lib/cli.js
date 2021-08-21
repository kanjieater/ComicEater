const { argv } = require('yargs')(process.argv.slice(2))
  .usage('Usage: $0 --convertToCBZ')
  .demandCommand(1);
const log = require('./logger');
const { getArchives, convertToCBZBatch } = require('./archiver');
const {
  getSeries,
  moveIdentifiedSeriesToSeriesFolder,
} = require('./series');
const { setMetaFiles } = require('./meta');
const { getCleanPath } = require('./utils');

function logResults({ successful, unsuccessful, action}) {
  log.debug(`Logging result for "${action}"`);
  let failedMessage = '';
  unsuccessful.forEach(({ error, context: { archivePath } }, index) => {
    failedMessage += `Failed converting ${index + 1}/${unsuccessful.length} "${archivePath}" because of:\n ${error.stack}\n`;
  });
  log.info(`Successful "${action}": ${successful.length}`);
  if (unsuccessful.length !== 0) {
    log.error(`Failed: ${unsuccessful.length}\n  ${failedMessage}`);
  } else {
    log.info(`Finished "${action}" successfully. No failures.`);
  }
}

async function convertToCBZBatchCLI(archivePath) {
  const archives = await getArchives(archivePath)
    .catch((err) => log.error(err));
  if (!(archives && archives.length)) {
    log.error(`No archive found at ${archivePath}`);
    return;
  }

  convertToCBZBatch(archives)
    .then((result) => {
      logResults(result, 'Convert To CBZ');
    });
}

async function convertToSeriesCLI(archivePath, { seriesFolder }) {
  const archives = await getArchives(archivePath, ['cbz'])
    .catch((err) => log.error(err));
  if (!(archives && archives.length)) {
    log.error(`No archive found at ${archivePath}`);
    return;
  }

  const identifiedSeriesMetaResults = await getSeries(archives);
  const identified = identifiedSeriesMetaResults.successful;
  const moveResult = await moveIdentifiedSeriesToSeriesFolder(identified, seriesFolder);
  const setMetaResults = await setMetaFiles(moveResult.successful);
  logResults(identifiedSeriesMetaResults);
  logResults(moveResult);
  logResults(setMetaResults);
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
