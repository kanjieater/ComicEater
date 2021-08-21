const clone = require('just-clone');
const merge = require('just-merge');
const util = require('util');
const log = require('./logger');
const { addDirToArchive, extractFileFromArchive } = require('./archiver');
const {
  getTmpPath, rm, writeFile, readFile,
} = require('./files');
const { getResults } = require('./utils');

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

function logMetaData(metaData) {
  let metaDataLog = 'MetaData at this point: \n';
  if (metaData) {
    Object.entries(metaData).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        metaDataLog += `${key}: `;
        value.forEach((subvalue, index) => {
          const contents = util.inspect(subvalue, { depth: null });
          metaDataLog += `${index}:    ${contents}`;
        });
      } else {
        metaDataLog += `${key}: ${value}\n`;
      }
    });
  }
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

  logMetaData(metaData);
  return metaData;
}

async function getExistingMeta(archivePath) {
  log.debug(`Extracting meta file if it exists from ${archivePath}`);
  const metaData = await readMetaFile(archivePath);
  if (metaData) {
    return merge(DEFAULT_META_FIELDS, metaData);
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

async function getUpdatedHistory(history, action) {
  // log.debug(`Retrieving history from ${filePath}`);
  const existingHistory = history;
  existingHistory.push(createHistoryEntry(action));
  let existingHistoryLog = '';
  existingHistory.forEach((historyEntry) => {
    existingHistoryLog += `${historyEntry.date}: "${historyEntry.action}"\n`;
  });
  log.debug(`History is now: \n'${existingHistoryLog}'`);
  return existingHistory;
}

async function setMetaFile(filePath, metaData, actionDone) {
  log.debug(`Writing Meta File to ${filePath}`);
  const existingMeta = await getExistingMeta(filePath);

  const historyEntry = getUpdatedHistory(existingMeta.history, actionDone);
  const updatedMetaData = merge(existingMeta, metaData, historyEntry);
  logMetaData(updatedMetaData);
  const tmpPath = getTmpPath(filePath);

  await writeFile(JSON.stringify(updatedMetaData, null, 2), `${tmpPath.fileDir}/${CUSTOM_META_FILE_NAME}`);
  await addDirToArchive(tmpPath.fileDir, filePath);
  await rm(tmpPath.fileDir, false);
}

async function setMetaFiles(metaData) {
  async function callback(aMetaData, successful, unsuccessful) {
    try {
      await setMetaFile(aMetaData.archivePath, aMetaData, 'Set Meta Data');
      successful.push(aMetaData);
    } catch (error) {
      unsuccessful.push({ error, metaData: aMetaData });
    }
  }
  return getResults(metaData, callback);
}

module.exports = {
  setMetaFile,
  setMetaFiles,
};
