const clone = require('just-clone');
const { diff } = require('just-diff');
const { inspect } = require('util');
const log = require('./logger');
const { addDirToArchive, extractFileFromArchive } = require('./archiver');
const {
  getTmpPath, rm, writeFile, readFile,
} = require('./files');
const { getResults } = require('./saga');
const { writeComicInfo } = require('./comicInfo');
const { getWrittenHistory, getUpdatedHistory } = require('./history');

const SET_META_DATA = 'Set Meta Data';
const actions = {
  SET_META_DATA,
};
const CUSTOM_META_FILE_NAME = 'ComicEater.json';

const DEFAULT_META_FIELDS = {
  // title: null,
  // series: null,
  // number: null,
  // volume: null, // volume year
  // alternativeSeries: null,
  // seriesGroup: null,
  // summary: null,
  // notes: null,
  // year: null,
  // month: null,
  // day: null,
  // publisher: null,
  // write: null,
  // pageCount: null,
  // genre: [],
  history: [],
};

function logMetaData(contentMetaData, archivePath, action) {
  const metaDataLog = `ContentMetaData at the point of "${action}" for "${archivePath}"\n${inspect(contentMetaData || {}, { depth: null })}": \n`;
  log.debug(metaDataLog);
}

function parseMetaFileContents(fileContents, filePath) {
  try {
    return JSON.parse(fileContents);
  } catch (e) {
    log.warn(`Existing ${CUSTOM_META_FILE_NAME} could not be parse in ${filePath}`);
  }
  return null;
}

async function readMetaFile(archivePath) {
  const { fileDir } = getTmpPath(archivePath);
  const filePath = await extractFileFromArchive(CUSTOM_META_FILE_NAME, archivePath, fileDir);
  let contentMetaData = null;
  try {
    const fileContents = await readFile(filePath);
    contentMetaData = parseMetaFileContents(fileContents, filePath);
  } catch (e) {
    log.warn(`Valid existing ${CUSTOM_META_FILE_NAME} not found in ${filePath}`);
  }

  logMetaData(contentMetaData, archivePath, 'Reading Existing Meta Data');
  return contentMetaData;
}

async function getExistingMeta(archivePath) {
  log.debug(`Extracting meta file if it exists from ${archivePath}`);
  const readMetaData = await readMetaFile(archivePath);
  if (readMetaData) {
    return { ...DEFAULT_META_FIELDS, ...readMetaData };
  }
  return clone(DEFAULT_META_FIELDS);
}

function getMetaDataDiff(contextMetaData, existingMeta, archivePath) {
  const proposedMetaData = {
    ...existingMeta,
    ...contextMetaData,
  };
  delete proposedMetaData.history;
  const em = clone(existingMeta);
  delete em.history;
  const metaDataDiff = diff(em, proposedMetaData);
  log.debug(`Meta Data diff for "${archivePath}":\n ${inspect(metaDataDiff)}`);
  if (metaDataDiff.length) {
    return metaDataDiff;
  }
  return false;
}

async function setMetaFile(context, recordChange = false) {
  const {
    archivePath, contentMetaData, history,
  } = context;
  logMetaData(contentMetaData, archivePath, 'Context Meta Data');
  log.debug(`Writing Meta File to ${archivePath}`);
  const newHistory = getWrittenHistory(history);
  const updatedContext = { ...context, action: SET_META_DATA, recordChange };

  const existingMeta = await getExistingMeta(archivePath);
  const metaDataDiff = getMetaDataDiff(contentMetaData, existingMeta, archivePath);
  if (!newHistory.length && !recordChange) {
    log.info(`No changes were necessary to: "${archivePath}"`);
    return updatedContext;
  }

  // TODO Actually want this to update no matter what in case you want to erase a bad run.
  // Maybe make this optional?
  // if (!metaDataDiff) {
  //   log.info(`Series Meta Data was unchanged for: "${archivePath}"`);
  // }

  log.debug('Merging file history and context history');
  const knownHistory = [...existingMeta.history, ...newHistory];
  // We have to handle our own history before the file is written
  const updatedHistory = getUpdatedHistory(
    knownHistory,
    SET_META_DATA,
    {
      ...context,
      diff: metaDataDiff,
    },
    true,
  );

  // TODO Quick fix to reset bad volume numbers
  delete existingMeta.volumeRange;
  // TODO deep copy arrays of contentMetaData
  const updatedMetaData = {
    ...existingMeta,
    ...contentMetaData,
    history: updatedHistory,
  };
  logMetaData(updatedMetaData, archivePath, 'Merged Meta Data');
  const tmpPath = getTmpPath(archivePath);
  await writeFile(JSON.stringify(updatedMetaData, null, 2), `${tmpPath.fileDir}/${CUSTOM_META_FILE_NAME}`);
  await writeComicInfo(updatedMetaData, tmpPath.fileDir, updatedContext);

  // Remove history from content contentMetaData
  delete updatedMetaData.history;

  await addDirToArchive(tmpPath.fileDir, archivePath);
  await rm(tmpPath.fileDir, false);
  return {
    ...updatedContext,
    contentMetaData: updatedMetaData,
    historyToBeWritten: updatedHistory,
    recordChange: true,
  };
}

async function setMetaFiles(contexts) {
  return getResults(SET_META_DATA, contexts, setMetaFile);
}

module.exports = {
  setMetaFile,
  setMetaFiles,
  actions,
};
