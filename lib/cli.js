const { argv } = require('yargs')(process.argv.slice(2))
  .usage('Usage: $0 --convertToCBZ')
  .demandCommand(1);

const log = require('./logger');
// log.info('huh')
const archiver = require('./archiver');
const series = require('./series');
const { getCleanPath } = require('./utils');

function logProgress({ successful, unsuccessful }, action) {
  let failedMessage = '';
  unsuccessful.forEach(({ error, metaData: { archivePath } }, index) => {
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
  const archives = await archiver.getArchives(archivePath)
    .catch((err) => log.error(err));
  if (!(archives && archives.length)) {
    log.error(`No archive found at ${archivePath}`);
    return;
  }

  archiver.convertToCBZBatch(archives)
    .then((result) => {
      logProgress(result, 'Convert To CBZ');
    });
}

async function convertToSeriesCLI(archivePath, config) {
  const archives = await archiver.getArchives(archivePath, ['cbz'])
    .catch((err) => log.error(err));
  if (!(archives && archives.length)) {
    log.error(`No archive found at ${archivePath}`);
    return;
  }

  const identifiedSeriesMetaResults = await series.getSeries(archives);
  const successfullyIdentified = identifiedSeriesMetaResults.successful;
  series.moveIdentifiedSeriesToSeriesFolder(successfullyIdentified, config.seriesFolder)
    .then((moveResult) => {
      // console.log.debug(, 'Archives Moved to Series Folder');
      logProgress(identifiedSeriesMetaResults, 'Identified Series');
      logProgress(moveResult, 'Archives Moved to Series Folder');
      // log.info('Finished series conversion');
    });
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
