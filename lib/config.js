const merge = require('deepmerge');
const clone = require('just-clone');
const log = require('./logger');
const { readYMLFile, getCurrentmaintenanceFolder } = require('./files');
const { getCleanPath, inspect, removeEmptyKeys } = require('./utils');

const ENV_WHITELIST = [
  'baseUrl',
  'username',
  'password',
];

const cliConfigDefaults = {
  offline: false,
  shouldDownloadCover: false,
  coverPath: false,
  coverQuery: false,
  noCoverValidate: false,
  upscale: false,
  trimWhiteSpace: false,
  splitPages: false,
};

function getCleanConfigPaths(series) {
  return series.map((seriesFolder) => {
    const cleanSeriesFolder = clone(seriesFolder);
    cleanSeriesFolder.queueFolders = cleanSeriesFolder?.queueFolders?.map(
      (queueFolder) => getCleanPath(queueFolder),
    );
    cleanSeriesFolder.maintenanceFolder = getCleanPath(
      cleanSeriesFolder?.maintenanceFolder,
    );
    cleanSeriesFolder.seriesRoot = getCleanPath(cleanSeriesFolder.seriesRoot);
    return cleanSeriesFolder;
  });
}

function getEachSeriesFoldersConfig(cliSeriesFolder, fileConfig, cliOptions) {
  if (!fileConfig?.seriesFolders?.length && !cliSeriesFolder) {
    throw new Error(
      'A seriesFolder must be given to the CLI. Or, in your config you must define seriesFolders',
    );
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
        ...cliConfigDefaults,
        ...seriesFolder,
        queuePath,
        maintenanceFolder: getCurrentmaintenanceFolder(
          seriesFolder.maintenanceFolder,
        ),
        maintenanceRoot: seriesFolder.maintenanceFolder,
        ...removeEmptyKeys(cliOptions),
      });
    });
  });
  log.debug(`Queue Folders: ${inspect(queueFolders)}`);
  return queueFolders;
}

function getFilteredEnvVars(argv) {
  return ENV_WHITELIST.reduce((acc, key) => {
    if (argv[key]) {
      acc[key] = argv[key];
    }
    return acc;
  }, {});
}

function getUpdatedDefaultsWithEnv(fileConfig, filteredEnvVars) {
  const updatedDefaults = {
    ...fileConfig.defaults,
    komga: {
      ...fileConfig.defaults?.komga,
      ...filteredEnvVars,
    },
  };
  return { ...fileConfig, defaults: updatedDefaults };
}

async function getConfig(cliConfig, argv) {
  const { seriesFolder: cliSeriesFolder, configFile, cliOptions } = cliConfig;
  const fileConfig = await readYMLFile(getCleanPath(configFile));
  log.debug(`YML file config: ${inspect(fileConfig)}`);
  const runtimeSeriesFolder = getEachSeriesFoldersConfig(
    cliSeriesFolder,
    fileConfig,
    cliOptions,
  );
  const queueFolders = getQueueFolders(runtimeSeriesFolder, cliOptions);
  const runTimeConfig = { seriesFolders: runtimeSeriesFolder, queueFolders };
  const filteredEnvVars = getFilteredEnvVars(argv);
  const updatedFileConfig = getUpdatedDefaultsWithEnv(fileConfig, filteredEnvVars);
  const config = {
    ...updatedFileConfig,
    ...cliConfig,
    ...runTimeConfig,
  };
  log.debug(`Current Config: ${inspect(config)}`);
  return config;
}

module.exports = {
  getConfig,
};
