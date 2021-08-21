const clone = require('just-clone');
const { inspect } = require('util');
const log = require('./logger');
const { addDirToArchive, extractFileFromArchive } = require('./archiver');
const {
  getTmpPath, rm, writeFile, readFile,
} = require('./files');
const { getResults } = require('./utils');

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
  languageISO: 'ja',
  manga: 'YesAndRightToLeft',
  history: [],
};

function logMetaData(metaData, archivePath, action) {
  const metaDataLog = `MetaData at the point of "${action}" for "${archivePath}"\n${inspect(metaData || {}, { depth: null })}": \n`;
  log.debug(metaDataLog);
}

function getLocalDate() {
  const date = new Date().toLocaleTimeString('en-US');
  return date;
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
  let metaData = null;
  try {
    const fileContents = await readFile(filePath);
    metaData = parseMetaFileContents(fileContents, filePath);
  } catch (e) {
    log.warn(`Existing ${CUSTOM_META_FILE_NAME} not found in ${filePath}`);
  }

  logMetaData(metaData, archivePath, 'Reading Existing Meta Data');
  return metaData;
}

async function getExistingMeta(archivePath) {
  log.debug(`Extracting meta file if it exists from ${archivePath}`);
  const readMetaData = await readMetaFile(archivePath);
  if (readMetaData) {
    return { ...DEFAULT_META_FIELDS, ...readMetaData };
  }
  return clone(DEFAULT_META_FIELDS);
}

function createHistoryEntry(action) {
  return {
    action,
    date: getLocalDate(),
    timestamp: Date.now(),
  };
}

function logHistory(existingHistory) {
  let existingHistoryLog = '';
  existingHistory.forEach((historyEntry) => {
    existingHistoryLog += `${historyEntry.date}: "${historyEntry.action}"\n`;
  });
  log.debug(`History is now: \n'${existingHistoryLog}'`);
}

function getUpdatedHistory(history, action) {
  const existingHistory = clone(history);
  existingHistory.push(createHistoryEntry(action));
  logHistory(existingHistory);
  return existingHistory;
}

async function setMetaFile(context) {
  const { archivePath, metaData } = context;
  logMetaData(metaData, archivePath, 'Context Meta Data');
  log.debug(`Writing Meta File to ${archivePath}`);
  const existingMeta = await getExistingMeta(archivePath);
  const history = getUpdatedHistory(existingMeta.history, SET_META_DATA);

  const updatedMetaData = { ...existingMeta, ...metaData, history };
  logMetaData(updatedMetaData, archivePath, 'Merged Meta Data');

  const tmpPath = getTmpPath(archivePath);

  await writeFile(JSON.stringify(updatedMetaData, null, 2), `${tmpPath.fileDir}/${CUSTOM_META_FILE_NAME}`);
  await addDirToArchive(tmpPath.fileDir, archivePath);
  await rm(tmpPath.fileDir, false);
  return { ...context, metaData: updatedMetaData, action: SET_META_DATA };
}

async function setMetaFiles(contexts) {
  return getResults(SET_META_DATA, contexts, setMetaFile);
}

module.exports = {
  setMetaFile,
  setMetaFiles,
  actions,
};
