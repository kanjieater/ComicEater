const clone = require('just-clone');
const log = require('./logger');
const { getLocalDate } = require('./utils');

function createHistoryEntry(action, context, recordChange) {
  const snapshot = clone(context);
  // We don't want nested history of histories
  delete snapshot.history;
  delete snapshot.recordChange;
  return {
    action,
    // Used to determine if it's worth writing to the file in "Set Meta Data" saga
    recordChange,
    context: snapshot,
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

function getUpdatedHistory(history, action, context, recordChange) {
  let existingHistory = [];
  if (Array.isArray(history)) {
    existingHistory = clone(history);
  }
  existingHistory.push(createHistoryEntry(action, context, recordChange));
  logHistory(existingHistory);
  return existingHistory;
}

function getWrittenHistory(history) {
  log.debug('Removing unneeded history data');
  return history.filter((h) => {
    if (!h.recordChange) {
      return false;
    }
    // TODO Don't disable the lint
    // eslint-disable-next-line no-param-reassign
    delete h.recordChange;
    return true;
  });
}

module.exports = {
  getUpdatedHistory,
  getWrittenHistory,
};
