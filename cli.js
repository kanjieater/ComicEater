const { argv } = require('yargs')(process.argv.slice(2))
  .usage('Usage: $0 --convertToCBZ')
  .demandCommand(1);

const { log, getCleanPath } = require('./utils');
const archiver = require('./archiver');
const series = require('./series');

async function convertToCBZBatchCLI(archivePath) {
  const archives = await archiver.getArchives(archivePath)
    .catch((err) => log(err, 'error'));
  if (!(archives && archives.length)) {
    log(`No archive found at ${archivePath}`, 'error');
  }

  archiver.convertToCBZBatch(archives)
    .then(() => log('Finished CBZ conversion', 'info'));
}

async function convertToSeriesCLI(archivePath) {
  const archives = await archiver.getArchives(archivePath)
    .catch((err) => log(err, 'error'));
  if (!(archives && archives.length)) {
    log(`No archive found at ${archivePath}`, 'error');
  }

  series.convertToSeries(archives)
    .then(() => log('Finished series conversion', 'info'));
}

function parseCommands() {
  const argPath = argv._[0];
  log(`Converting "${argPath}" to standardized path`);

  const cleanPath = getCleanPath(argPath);
  log(`Converted to "${cleanPath}"`);

  if (argv.convertToCBZ) {
    convertToCBZBatchCLI(cleanPath);
  } else if (argv.convertToSeries) {
    convertToSeriesCLI(cleanPath);
  } else {
    log('No command run', 'error');
  }
}

module.exports = {
  convertToCBZBatchCLI,
  parseCommands,
};
