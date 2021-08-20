const clone = require('just-clone');
const merge = require('just-merge');
const util = require('util');
const { addDirToArchive, extractFileFromArchive } = require('./archiver');
const { log } = require('./logger');
const {
  getTmpPath, rm, writeFile, readFile,
} = require('./files');

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
  log(metaDataLog);
}

function getLocalDate() {
  const date = new Date().toLocaleTimeString('en-US');
  return date;
}

async function readMetaFile(archivePath) {
  const { fileDir } = getTmpPath(archivePath);
  const filePath = await extractFileFromArchive(CUSTOM_META_FILE_NAME, archivePath, fileDir);
  const metaData = JSON.parse(await readFile(filePath));
  logMetaData(metaData);
  return metaData;
}

async function getExistingMeta(archivePath) {
  log(`Extracting meta file if it exists from ${archivePath}`);
  const metaData = await readMetaFile(archivePath);
  if (metaData) {
    return metaData;
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
  // log(`Retrieving history from ${filePath}`);
  const existingHistory = history;
  existingHistory.push(createHistoryEntry(action));
  let existingHistoryLog = '';
  existingHistory.forEach((historyEntry) => {
    existingHistoryLog += `${historyEntry.date}: "${historyEntry.action}"\n`;
  });
  log(`History is now: \n'${existingHistoryLog}'`);
  return existingHistory;
}

async function setMetaFile(filePath, metaData, actionDone) {
  log(`Writing Meta File to ${filePath}`);
  const existingMeta = await getExistingMeta(filePath);

  const historyEntry = getUpdatedHistory(existingMeta.history, actionDone);
  const updatedMetaData = merge(existingMeta, metaData, historyEntry);
  logMetaData(updatedMetaData);
  const tmpPath = getTmpPath(filePath);

  await writeFile(JSON.stringify(updatedMetaData, null, 2), `${tmpPath.fileDir}/${CUSTOM_META_FILE_NAME}`);
  await addDirToArchive(tmpPath.fileDir, filePath);
  await rm(tmpPath.fileDir, false);
}

module.exports = {
  setMetaFile,
};
