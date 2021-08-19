const { argv } = require('yargs')(process.argv.slice(2))
  .usage('Usage: $0 --convertToCBZ')
  .demandCommand(1);

const archiver = require('./archiver');
const series = require('./series');
const { getCleanPath } = require('./utils');
const { log } = require('./logger');

async function convertToCBZBatchCLI(archivePath) {
  const archives = await archiver.getArchives(archivePath)
    .catch((err) => log(err, 'error'));
  if (!(archives && archives.length)) {
    log(`No archive found at ${archivePath}`, 'error');
    return;
  }

  archiver.convertToCBZBatch(archives)
    .then(() => log('Finished CBZ conversion', 'info'));
}

async function convertToSeriesCLI(archivePath, config) {
  const archives = await archiver.getArchives(archivePath)
    .catch((err) => log(err, 'error'));
  if (!(archives && archives.length)) {
    log(`No archive found at ${archivePath}`, 'error');
    return;
  }

  const identifiedSeries = await series.getSeries(archives);

  series.moveIdentifiedSeriesToSeriesFolder(identifiedSeries, config.seriesFolder)
    .then(() => log('Finished series conversion', 'info'));
}


function parseCommands() {
  const argPath = argv._[0];
  const cleanPath = getCleanPath(argPath);

  if (argv.convertToCBZ) {
    convertToCBZBatchCLI(cleanPath);
  } else if (argv.convertToSeries) {
    const seriesFolder = getCleanPath(argv.seriesFolder);
    convertToSeriesCLI(cleanPath, { seriesFolder });
  }
    log('No command run', 'error');
  }
}

module.exports = {
  convertToCBZBatchCLI,
  convertToSeriesCLI,
  parseCommands,
};
