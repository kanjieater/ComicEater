const { argv } = require('yargs')(process.argv.slice(2))
  .usage('Usage: $0 --convertToCBZ');
  // .demandCommand(1);

const log = require('./logger');
const {
  convertToCBZBatch,
} = require('./archiver');
const {
  getVolumeStartPaths,
} = require('./volumeFinder');
const { getArchives } = require('./command');
const {
  getSeries,
  moveIdentifiedSeriesToSeriesFolder,
  getSeriesWithRemoteMetaData,
} = require('./series');

const { setMetaFiles } = require('./meta');
const { getCleanPath, inspect, getFilteredOutNested } = require('./utils');
const {
  writeFile, cleanSuccessfulResults, getAllFiles, moveFilesToMaintenanceSaga,
} = require('./files');
const { logByLevel, getResultLog } = require('./saga');
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
      async (queueFolder) => {
        const archives = await getArchives(queueFolder.queuePath, undefined, queueFolder);
        const volumeStartPaths = await getVolumeStartPaths(queueFolder.queuePath, queueFolder);
        return archives.concat(volumeStartPaths);
      },
    ),
  );
  return Array.prototype.concat(...arrays);
}

async function getRemainingFiles(queueFolders) {
  const arrays = await Promise.all(
    queueFolders.map(
      async (queueFolder) => ({
        ...queueFolder,
        filePaths: [
          ...(await getAllFiles(queueFolder.queuePath)),
        ],
      }),
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
    const folderList = config.queueFolders.map(({ queuePath }) => queuePath);
    log.warn(`No archive found at queueFolders: "${inspect(folderList)}`);
  }
  return archives;
}

function logAllResults(allResultsLogs) {
  if (allResultsLogs.length <= 0) {
    return;
  }
  allResultsLogs.forEach((resultsLog) => {
    logByLevel(resultsLog);
  });
}

async function setMetaData(sagaResults, recordChange) {
  const filteredSubFolderResults = getFilteredOutNested(sagaResults.successful);
  const setMetaResults = await setMetaFiles(filteredSubFolderResults, recordChange);
  return {
    allResultsLogs: [getResultLog(setMetaResults)],
    latestResults: setMetaResults,
  };
}

async function setMetaDataCLI(config) {
  const archives = await getArchivesFromConfig(config);
  const identifiedSeriesMetaResults = await getSeries(archives);
  const results = await setMetaData(identifiedSeriesMetaResults, true);
  return {
    allResultsLogs: [getResultLog(results)],
    latestResults: results,
  };
}

async function convertToCBZBatchCLI(archives) {
  const convertToCBZBatchSagaResults = await convertToCBZBatch(archives);
  return {
    allResultsLogs: [getResultLog(convertToCBZBatchSagaResults)],
    latestResults: convertToCBZBatchSagaResults,
  };
}

async function convertToSeriesCLI(archives, useRemoteSources = true) {
  const identifiedSeriesMetaResults = await getSeries(archives);
  const identified = identifiedSeriesMetaResults.successful;
  const allResultsLogs = [getResultLog(identifiedSeriesMetaResults)];
  let remoteIdentified;
  if (useRemoteSources) {
    remoteIdentified = await getSeriesWithRemoteMetaData(identified);
    allResultsLogs.push(getResultLog(remoteIdentified));
  }
  const moveResult = await moveIdentifiedSeriesToSeriesFolder(
    remoteIdentified?.successful || identified,
  );
  allResultsLogs.push(getResultLog(moveResult));

  return {
    allResultsLogs,
    latestResults: moveResult,
  };
}

async function maintainCollectionCLI(config) {
  const archives = await getArchivesFromConfig(config);
  const CBZResults = await convertToCBZBatchCLI(archives);
  const successfulCBZResults = CBZResults.latestResults.successful;
  const seriesResults = await convertToSeriesCLI(successfulCBZResults, true);
  return {
    allResultsLogs: [...CBZResults.allResultsLogs, ...seriesResults.allResultsLogs],
    latestResults: seriesResults.latestResults,
  };
}

async function moveToMaintenance(config) {
  const remainingFiles = await getRemainingFiles(config.queueFolders);
  const results = await moveFilesToMaintenanceSaga(remainingFiles);

  return {
    allResultsLogs: [getResultLog(results)],
    latestResults: results,
  };
}

async function suggestNamingCLI(config) {
  const archives = await getArchivesFromConfig(config);
  const identifiedSeriesMetaResults = await getSeries(archives);
  const identified = identifiedSeriesMetaResults.successful;
  const remoteIdentified = await getSeriesWithRemoteMetaData(identified);
  return {
    allResultsLogs: [getResultLog(identifiedSeriesMetaResults), getResultLog(remoteIdentified)],
    latestResults: remoteIdentified,
  };
}

async function cleanSuccessfulResultsCLI(existingResults) {
  const results = await cleanSuccessfulResults(existingResults);
  return {
    allResultsLogs: [getResultLog(results)],
    latestResults: results,
  };
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
  let allResultsLogs = [];
  let resultsAndLogs;
  let latestResults;
  let runMeta = true;
  let shouldMoveToMaintenance = false;
  const configFile = getCleanPath(argv.configFile);
  const config = await getConfig({ configFile });
  if (argv.convertToCBZ) {
    const archives = await getArchivesCLI(cleanArchivePath);
    resultsAndLogs = await convertToCBZBatchCLI(archives);
  } else if (argv.convertToSeries) {
    const archives = await getArchivesFromConfig(config);
    resultsAndLogs = await convertToSeriesCLI(archives, config);
    shouldMoveToMaintenance = true;
  } else if (argv.maintainCollection) {
    resultsAndLogs = await maintainCollectionCLI(config);
    shouldMoveToMaintenance = true;
  } else if (argv.suggestNaming) {
    resultsAndLogs = await suggestNamingCLI(config);
    runMeta = false;
  } else if (argv.showArchives) {
    const archives = await getArchivesCLI(cleanArchivePath);
    resultsAndLogs = await showArchivesCLI(archives);
    runMeta = false;
  } else if (argv.setMetaData) {
    resultsAndLogs = await setMetaDataCLI(config);
    runMeta = false;
  } else {
    log.error('No command run');
    runMeta = false;
    return;
  }
  latestResults = resultsAndLogs.latestResults;
  allResultsLogs = resultsAndLogs.allResultsLogs;
  if (runMeta) {
    // const [finalResult] = allResults.slice(-1);
    resultsAndLogs = await setMetaData(latestResults);
    latestResults = resultsAndLogs.latestResults;
    allResultsLogs = allResultsLogs.concat(resultsAndLogs.allResultsLogs);
  }
  const cleanResultsAndLogs = await cleanSuccessfulResultsCLI(latestResults);
  allResultsLogs = allResultsLogs.concat(cleanResultsAndLogs.allResultsLogs);

  if (shouldMoveToMaintenance) {
    resultsAndLogs = await moveToMaintenance(config);
    allResultsLogs = allResultsLogs.concat(resultsAndLogs.allResultsLogs);
  }

  logAllResults(allResultsLogs);
}

module.exports = {
  convertToCBZBatchCLI,
  convertToSeriesCLI,
  parseCommands,
};
