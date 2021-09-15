const merge = require('deepmerge');
const clone = require('just-clone');
const log = require('./logger');
const { readYMLFile } = require('./files');
const { getCleanPath, inspect, removeEmptyKeys } = require('./utils');

function getCleanConfigPaths(series) {
  return series.map((seriesFolder) => {
    const cleanSeriesFolder = clone(seriesFolder);
    cleanSeriesFolder.queueFolders = cleanSeriesFolder?.queueFolders?.map(
      (queueFolder) => getCleanPath(queueFolder),
    );
    cleanSeriesFolder.seriesRoot = getCleanPath(cleanSeriesFolder.seriesRoot);
    return cleanSeriesFolder;
  });
}

function getEachSeriesFoldersConfig(cliSeriesFolder, fileConfig, cliOptions) {
  if (!fileConfig?.seriesFolders?.length && !cliSeriesFolder) {
    throw new Error('A seriesFolder must be given to the CLI. Or, in your config you must define seriesFolders');
  }
  let runtimeSeriesFolders;
  if (cliSeriesFolder) {
    runtimeSeriesFolders = cliSeriesFolder;
  } else if (!runtimeSeriesFolders?.length) {
    runtimeSeriesFolders = fileConfig.seriesFolders;
  }

  if (!fileConfig.defaults) {
    throw new Error('defaults must be defined in the config file');
  }
  const defaults = clone(fileConfig)?.defaults;
  defaults.maintenanceFolder = getCleanPath(defaults?.maintenanceFolder);
  let defaultSeriesFolders = {};
  if (defaults?.seriesFolders) {
    defaultSeriesFolders = defaults?.seriesFolders;
    delete defaults.seriesFolders;
  }
  const seriesWithDefaults = runtimeSeriesFolders.map((seriesFolder) => {
    const deepMergedDefaults = merge.all([
      seriesFolder,
      defaultSeriesFolders,
      defaults || {},
    ]);
    return { ...deepMergedDefaults, ...removeEmptyKeys(cliOptions) };
  });
  const seriesWithCleanPaths = getCleanConfigPaths(seriesWithDefaults);
  log.debug(`Series Folders: ${inspect(seriesWithCleanPaths)}`);
  return seriesWithCleanPaths;
}

function getQueueFolders(runtimeSeriesFolder, cliOptions) {
  const queueFolders = [];
  runtimeSeriesFolder.forEach((seriesFolder) => {
    seriesFolder?.queueFolders?.forEach((queuePath) => {
      queueFolders.push({
        ...seriesFolder,
        queuePath,
        ...removeEmptyKeys(cliOptions),
      });
    });
  });
  log.debug(`Queue Folders: ${inspect(queueFolders)}`);
  return queueFolders;
}

async function getConfig(cliConfig) {
  const { seriesFolder: cliSeriesFolder, configFile, cliOptions } = cliConfig;
  const fileConfig = await readYMLFile(getCleanPath(configFile));
  log.debug(`YML file config: ${inspect(fileConfig)}`);
  const runtimeSeriesFolder = getEachSeriesFoldersConfig(cliSeriesFolder, fileConfig, cliOptions);
  const queueFolders = getQueueFolders(runtimeSeriesFolder, cliOptions);
  const runTimeConfig = { seriesFolders: runtimeSeriesFolder, queueFolders };
  const config = {
    ...fileConfig,
    ...cliConfig,
    ...runTimeConfig,
  };
  config.defaults.maintenanceFolder = getCleanPath(config?.defaults?.maintenanceFolder);
  log.debug(`Current Config: ${inspect(config)}`);
  return config;
}

module.exports = {
  getConfig,
};
