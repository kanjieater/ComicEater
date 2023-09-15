const clone = require('just-clone');
const log = require('./logger');
const {
  getFolderMetaData,
  getFileMetaData,
  mapSeries,
} = require('./seriesFinder');
const { moveFile, cleanQueues } = require('./files');
const { getResults } = require('./saga');
const { getPathData, preferNative, getFilteredOutNested } = require('./utils');
const { getFileFormattedMetaData, removeJunk } = require('./format');
const { getAnilistData } = require('./anilist');

const GET_SERIES_FROM_FILE = 'Identify Series From File';
const IDENTIFY_SERIES = 'Identify Series';
const MOVE_ARCHIVE_TO_SERIES_FOLDER = 'Move Archive to Series Folder';
const GET_DATA_FROM_REMOTE_SOURCES = 'Retrieve MetaData From Remote Sources';

const actions = {
  GET_SERIES_FROM_FILE,
  IDENTIFY_SERIES,
  MOVE_ARCHIVE_TO_SERIES_FOLDER,
};

function getLocalMetaData(cleanedArchivePath, rootPath, context) {
  const { fileName, dir } = getPathData(cleanedArchivePath);

  let folderMetaData = {};
  const relativeFolder = `${dir}/`.replace(rootPath, '');
  if (relativeFolder) {
    folderMetaData = getFolderMetaData(relativeFolder, context.folderPatterns, context);
  }
  const fileMetaData = getFileMetaData(fileName, context.filePatterns, context);
  const contentMetaData = {
    ...folderMetaData,
    ...fileMetaData,
    ...(context?.contentMetaData || {}),
  };
  if (fileMetaData.volumeNumber !== undefined) {
    contentMetaData.volumeNumber = fileMetaData.volumeNumber;
  }
  if (contentMetaData.seriesName) {
    contentMetaData.seriesName = preferNative(
      folderMetaData.seriesName,
      fileMetaData.seriesName,
      contentMetaData.languageISO,
    );
  }
  if ((context?.contentMetaData
    && context?.contentMetaData?.volumeStartPath
    && context?.contentMetaData?.volumeRange === undefined)
    || (fileMetaData?.volumeRange === undefined)
  ) {
    // Trust what was given to us by previous contexts, as they may have the archive metadata.
    delete contentMetaData?.volumeRange;
  }
  const seriesMapping = mapSeries(fileMetaData, folderMetaData, context);
  if (seriesMapping) {
    contentMetaData.seriesName = seriesMapping;
    contentMetaData.seriesNameOverride = true;
  }
  return contentMetaData;
}

function getFilePathMetaData(context) {
  const {
    archivePath, queuePath,
  } = context;
  const cleanedArchivePath = removeJunk(archivePath, context.junkToFilter);

  const contentMetaData = getLocalMetaData(cleanedArchivePath, queuePath, context);
  const updatedContext = { ...clone(context), cleanedArchivePath };

  return {
    ...updatedContext,
    contentMetaData,
  };
}

async function identifySeriesFromFile(context) {
  const { archivePath } = context;
  log.debug(`Identifying series from "${archivePath}"`);
  const contentContext = getFilePathMetaData(context);
  log.debug(`Identified "${archivePath}" as "${contentContext.contentMetaData.seriesName}"`);
  return {
    ...context,
    ...contentContext,

    action: GET_SERIES_FROM_FILE,
    recordChange: false,
  };
}

async function moveArchiveToSeriesFolder(archivePath, outputFilePath) {
  if (archivePath !== outputFilePath) {
    log.info(`Moving content to "${outputFilePath}"`);
    await moveFile(archivePath, outputFilePath);
  } else {
    log.info(`Archive already exists in the correct Series Folder: "${outputFilePath}"`);
  }

  return outputFilePath;
}

async function moveIdentifiedSeriesToSeriesFolder(identifiedContext) {
  async function getResult(context) {
    const { archivePath, fileFormattedMetaData: { outputFilePath } } = context;

    const newArchivePath = await moveArchiveToSeriesFolder(archivePath, outputFilePath);
    return {
      ...context,
      archivePath: newArchivePath,
      originalArchivePath: archivePath,
      action: MOVE_ARCHIVE_TO_SERIES_FOLDER,
      recordChange: archivePath !== newArchivePath,
    };
  }
  const results = await getResults(MOVE_ARCHIVE_TO_SERIES_FOLDER, identifiedContext, getResult);
  await cleanQueues(results.successful);
  return results;
}

function logSuggestedSeries(results, unityMap) {
  results.successful.forEach((context) => {
    const {
      archivePath, fileFormattedMetaData, seriesRoot, queuePath,
    } = context;

    const { outputFilePath } = fileFormattedMetaData;
    const originalRelativeArchivePath = archivePath.replace(queuePath, '');
    const relativeArchivePath = outputFilePath.replace(seriesRoot, '');
    log.info(`Suggesting to rename:
     "${queuePath}" -> "${seriesRoot}"
     "${originalRelativeArchivePath}" to
     "${relativeArchivePath}"`);
    // log.debug(`Based on:\n"${inspect(contentMetaData)}"`);
  });
  Object.entries(unityMap).forEach(([key, { unifiedSeriesName, seriesEntries }], index, arr) => {
    log.info(`${index + 1}/${arr.length}
    "${key}" grouped ${seriesEntries.length} entries as:
     ${unifiedSeriesName}`);
  });
}

function getCommonSeriesKey(context) {
  const { fileName } = getPathData(context.archivePath);
  return context?.volumeStartPath
  || context?.rootPath
  || context?.contentMetaData.seriesName
  || fileName;
}

function getUnityMap(contexts) {
  const unityMap = {};
  contexts.forEach((context) => {
    const key = getCommonSeriesKey(context);
    if (!key) {
      return;
    }
    if (unityMap[key]) {
      const series = unityMap[key];
      const { languageISO, seriesName } = context.contentMetaData;
      series.seriesEntries.push(context);
      series.unifiedSeriesName = preferNative(series.unifiedSeriesName, seriesName, languageISO);
    } else {
      const { fileName } = getPathData(context.archivePath);
      unityMap[key] = {
        unifiedSeriesName: context.contentMetaData.seriesName || fileName,
        seriesEntries: [context],
      };
    }
  });
  return unityMap;
}

function unifySeriesResults(contexts, unityMap) {
  const updatedContexts = [];
  contexts.forEach((context) => {
    const key = getCommonSeriesKey(context);
    if (!key) {
      updatedContexts.push(context);
    }
    if (unityMap[key]) {
      const updatedContext = clone(context);
      const { unifiedSeriesName } = unityMap[key];
      if (unifiedSeriesName) {
        updatedContext.contentMetaData.seriesName = unifiedSeriesName;
      }
      updatedContexts.push(updatedContext);
    }
  });
  return updatedContexts;
}

function updateFileFormatting(contexts) {
  return contexts.map((context) => {
    const fileFormattedMetaData = getFileFormattedMetaData(
      context.contentMetaData,
      context,
    );
    return {
      ...context,
      fileFormattedMetaData,
    };
  });
}

function getUnifiedSeriesContexts(contexts, unityMap) {
  const seriesContexts = [];
  Object.keys(unityMap).forEach((key) => {
    let addedSeries = false;
    contexts.forEach((context) => {
      if (addedSeries) {
        return;
      }
      const seriesRoot = getCommonSeriesKey(context);
      if (seriesRoot === key) {
        seriesContexts.push(context);
        addedSeries = true;
      }
    });
    addedSeries = false;
  });
  return seriesContexts;
}

async function identifySeriesFromRemoteSource(context) {
  const updatedContext = clone(context);
  const anilistData = await getAnilistData(updatedContext);

  return {
    ...updatedContext,
    // contentMetaData,
    anilistData,
    GET_DATA_FROM_REMOTE_SOURCES,
    recordChange: false,
  };
}

function getMergedRemoteMetaData(individualContext, seriesContext) {
  return {
    ...individualContext,
    contentMetaData: {
      ...individualContext.contentMetaData,
      ...(seriesContext?.anilistData?.formattedData || {}),
    },
    anilistData: seriesContext?.anilistData,
  };
}

function mergeUnityWithIndividuals(individualContexts, seriesContexts) {
  const updatedContexts = [];
  const seriesMetaData = {};

  seriesContexts.forEach((seriesContext) => {
    const key = getCommonSeriesKey(seriesContext);
    seriesMetaData[key] = seriesContext;
  });
  individualContexts.forEach((individualContext) => {
    const key = getCommonSeriesKey(individualContext);
    updatedContexts.push(getMergedRemoteMetaData(individualContext, seriesMetaData[key]));
  });
  return updatedContexts;
}

async function getSeriesWithRemoteMetaData(contexts) {
  const unityMap = getUnityMap(contexts);
  const onlySeriesContexts = getUnifiedSeriesContexts(contexts, unityMap);
  const results = await getResults(
    GET_DATA_FROM_REMOTE_SOURCES,
    onlySeriesContexts,
    identifySeriesFromRemoteSource,
  );
  results.successful = mergeUnityWithIndividuals(contexts, results.successful);
  results.successful = updateFileFormatting(results.successful);
  logSuggestedSeries(results, unityMap);
  return results;
}

async function getSeries(archivePaths) {
  async function onFail(context) {
    return { archivePath: context.archivePath };
  }
  const nonNestedArchives = getFilteredOutNested(archivePaths);
  const results = await getResults(
    IDENTIFY_SERIES,
    nonNestedArchives,
    identifySeriesFromFile,
    onFail,
  );
  const unityMap = getUnityMap(results.successful);
  results.successful = unifySeriesResults(results.successful, unityMap);
  results.successful = updateFileFormatting(results.successful);
  logSuggestedSeries(results, unityMap);
  return results;
}

module.exports = {
  moveIdentifiedSeriesToSeriesFolder,
  identifySeriesFromFile,
  getSeriesWithRemoteMetaData,
  getSeries,
  actions,
};
