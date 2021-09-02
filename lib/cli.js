const { argv } = require('yargs')(process.argv.slice(2))
  .usage('Usage: $0 --convertToCBZ');
  // .demandCommand(1);

const log = require('./logger');
const {
  getArchives,
  convertToCBZBatch,
} = require('./archiver');
const {
  getSeries,
  moveIdentifiedSeriesToSeriesFolder,
} = require('./series');

const { setMetaFiles } = require('./meta');
const { getCleanPath, inspect, getFilteredOutNested } = require('./utils');
const { writeFile } = require('./files');
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

async function getArchivesArrays(queueFolders) {
  const arrays = await Promise.all(
    queueFolders.map(
      async (queueFolder) => getArchives(queueFolder.queuePath, undefined, queueFolder),
    ),
  );
  return Array.prototype.concat(...arrays);
}

async function getArchivesFromConfig(config) {
  let archives = [];
  try {
    archives = await getArchivesArrays(config.queueFolders);
  } catch (err) {
    log.error(err.stack);
  }
  if (!(archives && archives.length)) {
    log.warn(`No archive found at ${config.queueFolders}`);
  }
  return archives;
}

function logUnexpectedFiles(results) {
  let unexpectedFiles = [];
  results?.successful?.forEach((context) => {
    const unexpectedCount = context?.unexpected?.length;
    if (unexpectedCount === undefined || unexpectedCount <= 0) {
      return;
    }
    unexpectedFiles = unexpectedFiles.concat(context.unexpectedFiles);
  });
  if (unexpectedFiles.length !== 0) {
    log.warn(`The following unexpected archive contents were found while extracting:
    "${inspect(unexpectedFiles)}"
    They were successfully added to the new archive with all other valid content. Consider adding these file names to the filesToAllow or filesToDelete in your config file to not see this message in the future.
  `);
  }
}

function logAllResults(allResults) {
  if (allResults.length <= 0) {
    return;
  }
  const [finalResult] = allResults.slice(-1);
  logUnexpectedFiles(finalResult);
  allResults.forEach((results) => {
    logSagaResults(results);
  });
}

async function setMetaData(sagaResults, recordChange) {
  const filteredSubFolderResults = getFilteredOutNested(sagaResults.successful);
  const setMetaResults = await setMetaFiles(filteredSubFolderResults, recordChange);
  return [setMetaResults];
}

async function setMetaDataCLI(config) {
  const archives = await getArchivesFromConfig(config);
  const identifiedSeriesMetaResults = await getSeries(archives);
  const results = await setMetaData(identifiedSeriesMetaResults, true);
  return results;
}

async function convertToCBZBatchCLI(archives) {
  const convertToCBZBatchSagaResults = await convertToCBZBatch(archives);
  return [convertToCBZBatchSagaResults];
}

async function convertToSeriesCLI(archives) {
  const identifiedSeriesMetaResults = await getSeries(archives);
  const identified = identifiedSeriesMetaResults.successful;
  const moveResult = await moveIdentifiedSeriesToSeriesFolder(identified);
  return [identifiedSeriesMetaResults, moveResult];
}

async function maintainCollectionCLI(config) {
  const archives = await getArchivesFromConfig(config);
  let allResults = await convertToCBZBatchCLI(archives);
  const allCBZResults = allResults[allResults.length - 1].successful;
  allResults = allResults.concat(await convertToSeriesCLI(allCBZResults, config));
  return allResults;
}

async function suggestNamingCLI(config) {
  const archives = await getArchivesFromConfig(config);
  const identifiedSeriesMetaResults = await getSeries(archives);
  return [identifiedSeriesMetaResults];
}

async function showArchivesCLI(archives) {
  const pathList = archives.map(({ archivePath }) => archivePath);
  log.info(pathList);
  await writeFile(JSON.stringify(pathList), './showArchives.json', null, 2);
  return [];
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
    allResults = await maintainCollectionCLI(config);
  } else if (argv.suggestNaming) {
    const configFile = getCleanPath(argv.configFile);
    const config = await getConfig({ configFile });
    allResults = await suggestNamingCLI(config);
    runMeta = false;
  } else if (argv.showArchives) {
    const archives = await getArchivesCLI(cleanArchivePath);
    allResults = await showArchivesCLI(archives);
    runMeta = false;
  } else if (argv.setMetaData) {
    const configFile = getCleanPath(argv.configFile);
    const config = await getConfig({ configFile });
    allResults = await setMetaDataCLI(config);
    runMeta = false;
  } else {
    log.error('No command run');
    runMeta = false;
    return;
  }

  if (runMeta) {
    const [finalResult] = allResults.slice(-1);
    allResults = allResults.concat(await setMetaData(finalResult));
  }
  logAllResults(allResults);
}

module.exports = {
  convertToCBZBatchCLI,
  convertToSeriesCLI,
  parseCommands,
};
