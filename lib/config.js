const merge = require('deepmerge');
const clone = require('just-clone');
const { inspect } = require('util');
const log = require('./logger');
const { readYMLFile } = require('./files');
const { getCleanPath } = require('./utils');

function getCleanConfigPaths(series) {
  return series.map((seriesFolder) => {
    const cleanSeriesFolder = clone(seriesFolder);
    cleanSeriesFolder.queueFolders = cleanSeriesFolder?.queueFolders?.map(
      (queueFolder) => getCleanPath(queueFolder),
    );
    cleanSeriesFolder.root = getCleanPath(cleanSeriesFolder.root);
    return cleanSeriesFolder;
  });
}

function getEachSeriesFoldersConfig(cliSeriesFolder, fileConfig) {
  if (!fileConfig?.seriesFolders?.length && !cliSeriesFolder) {
    throw new Error('A seriesFolder must be given to the CLI. Or, in your config you must define seriesFolders');
  }
  let runtimeSeriesFolders;
  if (cliSeriesFolder) {
    runtimeSeriesFolders = cliSeriesFolder;
  } else if (!runtimeSeriesFolders?.length) {
    runtimeSeriesFolders = fileConfig.seriesFolders;
  }
  const defaults = clone(fileConfig)?.defaults;
  if (defaults?.seriesFolders) {
    runtimeSeriesFolders.push(defaults.seriesFolders);
    delete defaults.seriesFolders;
  }
  const seriesWithDefaults = runtimeSeriesFolders.map((seriesFolder) => {
    const deepMergedDefaults = merge.all([
      seriesFolder,
      defaults || {},
    ]);
    return deepMergedDefaults;
  });
  const seriesWithCleanPaths = getCleanConfigPaths(seriesWithDefaults);
  log.debug(`Series Folders: ${inspect(seriesWithCleanPaths, false, null, true)}`);
  return seriesWithCleanPaths;
}

function getQueueFolders(runtimeSeriesFolder) {
  const queueFolders = [];
  runtimeSeriesFolder.forEach((seriesFolder) => {
    seriesFolder?.queueFolders?.forEach((archivePath) => {
      queueFolders.push({
        ...seriesFolder,
        archivePath,
      });
    });
  });
  log.debug(`Queue Folders: ${inspect(queueFolders, false, null, true)}`);
  return queueFolders;
}

async function getConfig(cliConfig) {
  const { seriesFolder: cliSeriesFolder, configFile } = cliConfig;
  const fileConfig = await readYMLFile(getCleanPath(configFile));
  log.debug(`YML file config: ${inspect(fileConfig)}`);
  const runtimeSeriesFolder = getEachSeriesFoldersConfig(cliSeriesFolder, fileConfig);
  const queueFolders = getQueueFolders(runtimeSeriesFolder);
  const runTimeConfig = { seriesFolders: runtimeSeriesFolder, queueFolders };
  const config = {
    ...fileConfig,
    ...cliConfig,
    ...runTimeConfig,
  };
  log.info(`Current Config: ${inspect(config, false, null, true)}`);
  return config;
}

module.exports = {
  getConfig,
};
