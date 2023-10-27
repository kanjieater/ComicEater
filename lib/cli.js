const { argv } = require('yargs')(process.argv.slice(2))
  .scriptName('ComicEater')
  .usage('Usage: $0 --convertToCBZ');
// .demandCommand(1);
const path = require('path');
const lockfile = require('proper-lockfile');

const log = require('./logger');
const { convertToCBZBatch } = require('./archiver');
const { getVolumeStartPaths } = require('./volumeFinder');
const { getArchives } = require('./command');
const {
  getSeries,
  moveIdentifiedSeriesToSeriesFolder,
  getSeriesWithRemoteMetaData,
} = require('./series');

const { setMetaFiles } = require('./meta');
const {
  getCleanPath, inspect, getFilteredOutNested, sleep,
} = require('./utils');
const {
  writeFile,
  cleanSuccessfulResults,
  getAllFiles,
  moveFilesToMaintenanceSaga,
  getTmpPath,
} = require('./files');
const { logByLevel, getResultLog } = require('./saga');
const { getCovers } = require('./covers');
const { scanLibraries, handleTaggedCovers } = require('./komga');
const { getConfig } = require('./config');

async function getArchivesCLI(archivePath, extensions, context) {
  let archives = [];
  try {
    archives = await getArchives(archivePath, extensions, context);
  } catch (err) {
    log.error(err.stack);
  }
  if (!(archives && archives.length)) {
    log.warn(`No archive found at ${archivePath}`);
    return [];
  }
  return archives;
}

async function getArchivesArrays(folders, altPath) {
  const arrays = await Promise.all(
    folders.map(async (folder) => {
      const folderContext = { ...folder };
      if (altPath !== 'maintenanceFolder') {
        folderContext.maintenanceFolder = folderContext[altPath];
      }
      const archives = await getArchives(folderContext[altPath], undefined, folderContext);
      const volumeStartPaths = await getVolumeStartPaths(folderContext[altPath], folderContext);
      return archives.concat(volumeStartPaths);
    }),
  );
  return Array.prototype.concat(...arrays);
}

async function getRemainingFiles(queueFolders) {
  const arrays = await Promise.all(
    queueFolders.map(async (queueFolder) => ({
      ...queueFolder,
      filePaths: [...(await getAllFiles(queueFolder.queuePath))],
    })),
  );
  return Array.prototype.concat(...arrays);
}

function hasChanged(remainingFiles, changeCheckRemainingFiles) {
  return !remainingFiles.every(
    (_, i) => remainingFiles[i].filePaths.length === changeCheckRemainingFiles[i].filePaths.length,
  );
}

async function moveToMaintenance(config) {
  const lockFilePath = path.join(getTmpPath('/').dir, 'comiceater.lock'); // Specify the lock file path

  let retryCount = 0;
  const maxRetries = 5; // Maximum number of retries
  const retryDelay = 60000; // Delay between retries in milliseconds
  let checkChangeDelay = 1000;
  let haveLock = false;
  const lockOptions = {
    stale: 60000,
    realpath: false,
    lockfilePath: lockFilePath,
  };
  /* eslint-disable no-await-in-loop */
  while (!haveLock) {
    try {
      await lockfile.lock(lockFilePath, lockOptions);
      haveLock = true;
    } catch (error) {
      log.error('Failed to acquire the lock:', error);
      retryCount += 1;
      if (retryCount < maxRetries) {
        log.info(`Waiting until maintenance folder is unlocked, trying in ${retryDelay / 1000} seconds`);
        await sleep(retryDelay);
      } else {
        throw new Error('Failed to obtain a lock on the maintenance folder files');
      }
    }
  }
  let remainingFiles = [];
  let changeCheckRemainingFiles = [];
  do {
    remainingFiles = await getRemainingFiles(config.queueFolders);
    log.info(`Waiting to see if files have been changed in ${checkChangeDelay / 1000} seconds`);
    await sleep(checkChangeDelay);
    changeCheckRemainingFiles = await getRemainingFiles(config.queueFolders);
    checkChangeDelay += checkChangeDelay;
    const isLocked = await lockfile.check(lockFilePath, lockOptions);
    if (!isLocked) {
      throw new Error('Detected changes. Failed to obtain a lock on the maintenance folder files');
    }
  } while (hasChanged(remainingFiles, changeCheckRemainingFiles));
  /* eslint-enable no-await-in-loop */

  const results = await moveFilesToMaintenanceSaga(remainingFiles);
  await lockfile.unlock(lockFilePath, lockOptions);
  return {
    allResultsLogs: [getResultLog(results)],
    latestResults: results,
  };
}

async function getArchivesFromConfig(config, folder = 'maintenanceFolder') {
  let archives = [];
  try {
    archives = await getArchivesArrays(config.queueFolders, folder);
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
  const setMetaResults = await setMetaFiles(
    filteredSubFolderResults,
    recordChange,
  );
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

async function getCoversCLI(config, contexts = []) {
  let archives = contexts.filter((context) => {
    if (config?.cliOptions?.shouldDownloadCover === undefined) {
      return context?.shouldDownloadCover;
    }
    return config?.cliOptions?.shouldDownloadCover;
  });
  if (archives.length === 0 && config?.cliOptions?.coverPath) {
    const rawArchives = await getArchivesCLI(
      config.cliOptions.coverPath,
      undefined,
      config.seriesFolders[0],
    );
    archives = (await getSeries(rawArchives)).successful;
  }

  const coverResults = await getCovers(archives, config);

  return {
    allResultsLogs: [getResultLog(coverResults)],
    latestResults: coverResults,
  };
}

async function addToKomgaCLI(config, contexts = []) {
  if (!config.defaults?.komga) {
    log.info('No Komga config found. Skipping Komga related tasks.');
    return {
      allResultsLogs: [],
      latestResults: [],
    };
  }
  const scannedLibraries = await scanLibraries(contexts, config);

  return {
    allResultsLogs: [getResultLog(scannedLibraries)],
    latestResults: scannedLibraries,
  };
}

async function taggedCoversCLI(config, contexts = []) {
  if (!config.defaults?.komga) {
    log.info('No Komga config found. Skipping Komga related tasks.');
    return {
      allResultsLogs: [],
      latestResults: [],
    };
  }
  const coverResults = await handleTaggedCovers(config, contexts);

  return {
    allResultsLogs: [getResultLog(coverResults)],
    latestResults: coverResults,
  };
}

async function convertToSeriesCLI(config, archives) {
  const { offline } = config.cliOptions;

  const identifiedSeriesMetaResults = await getSeries(archives);
  const identified = identifiedSeriesMetaResults.successful;
  const allResultsLogs = [getResultLog(identifiedSeriesMetaResults)];
  let remoteIdentified;
  if (!offline) {
    remoteIdentified = await getSeriesWithRemoteMetaData(identified);
    allResultsLogs.push(getResultLog(remoteIdentified));
  }
  const moveResult = await moveIdentifiedSeriesToSeriesFolder(
    remoteIdentified?.successful || identified,
  );
  allResultsLogs.push(getResultLog(moveResult));

  const downloadedCovers = (
    await getCoversCLI(config, moveResult.successful)
  ).latestResults;
  allResultsLogs.push(getResultLog(downloadedCovers));

  return {
    allResultsLogs,
    latestResults: moveResult,
  };
}

async function maintainCollectionCLI(config) {
  const { allResultsLogs, latestResults } = await moveToMaintenance(config);
  if (latestResults.unsuccessful.length !== 0) {
    return { allResultsLogs, latestResults };
  }
  const archives = await getArchivesFromConfig(config);
  const CBZResults = await convertToCBZBatchCLI(archives);
  const successfulCBZResults = CBZResults.latestResults.successful;
  const seriesResults = await convertToSeriesCLI(config, successfulCBZResults);
  const taggedCoverResults = await taggedCoversCLI(
    config,
    seriesResults.latestResults.successful,
  );
  const komgaResults = await addToKomgaCLI(
    config,
    seriesResults.latestResults.successful,
  );

  return {
    allResultsLogs: [
      ...allResultsLogs,
      ...CBZResults.allResultsLogs,
      ...seriesResults.allResultsLogs,
      ...taggedCoverResults.allResultsLogs,
      ...komgaResults.allResultsLogs,
    ],
    latestResults: seriesResults.latestResults,
  };
}

async function suggestNamingCLI(config) {
  const archives = await getArchivesFromConfig(config, 'queuePath');
  const identifiedSeriesMetaResults = await getSeries(archives);
  let identified = identifiedSeriesMetaResults.successful;
  const allResultsLogs = [getResultLog(identifiedSeriesMetaResults)];

  if (!config.cliOptions.offline) {
    identified = await getSeriesWithRemoteMetaData(identified);
    allResultsLogs.push(getResultLog(identified));
  }
  return {
    allResultsLogs,
    latestResults: identified,
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
  process.on('unhandledRejection', (reason, p) => {
    log.error(`Unhandled Rejection at: Promise "${inspect(p)}",  reason: "${reason}"`);
  });
  process.on('uncaughtException', (err) => {
    log.error(`Uncaught Exception: ${err.stack || err}`);
  });

  const argPath = argv._[0];
  const cleanArchivePath = getCleanPath(argPath);
  let allResultsLogs = [];
  let resultsAndLogs;
  let runMeta = true;
  let shouldCleanUp = false;
  const configFile = getCleanPath(argv.configFile);
  const cliOptions = {
    offline: argv.offline || false,
    shouldDownloadCover: argv.downloadCover,
    coverPath:
      typeof argv.downloadCover === 'string'
        ? getCleanPath(argv.downloadCover)
        : argv.downloadCover,
    coverQuery: argv.coverQuery || false,
    noCoverValidate: argv.noCoverValidate || false,
    upscale: argv.upscale || false,
    trimWhiteSpace: argv.trimWhiteSpace || false,
    splitPages: argv.splitPages || false,
  };
  const config = await getConfig({ configFile, cliOptions });
  if (argv.convertToCBZ) {
    const archives = await getArchivesCLI(cleanArchivePath);
    resultsAndLogs = await convertToCBZBatchCLI(archives);
  } else if (argv.convertToSeries) {
    await moveToMaintenance(config);
    const archives = await getArchivesFromConfig(config);
    resultsAndLogs = await convertToSeriesCLI(config, archives);
    shouldCleanUp = true;
  } else if (argv.maintainCollection) {
    resultsAndLogs = await maintainCollectionCLI(config);
    shouldCleanUp = true;
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
  } else if (argv.getCovers) {
    resultsAndLogs = await getCoversCLI(config);
    runMeta = false;
  } else if (argv.komga) {
    resultsAndLogs = await addToKomgaCLI(config);
    runMeta = false;
  } else {
    log.error('No command run');
    runMeta = false;
    return;
  }
  const { latestResults } = resultsAndLogs;
  allResultsLogs = resultsAndLogs.allResultsLogs;
  if (runMeta) {
    // const [finalResult] = allResults.slice(-1);
    // resultsAndLogs = await setMetaData(latestResults, true);
    // latestResults = resultsAndLogs.latestResults;
    // allResultsLogs = allResultsLogs.concat(latestResults);
  }
  if (shouldCleanUp) {
    const cleanResultsAndLogs = await cleanSuccessfulResultsCLI(latestResults);
    allResultsLogs = allResultsLogs.concat(cleanResultsAndLogs.allResultsLogs);
  }

  logAllResults(allResultsLogs);
}

module.exports = {
  convertToCBZBatchCLI,
  convertToSeriesCLI,
  parseCommands,
};
