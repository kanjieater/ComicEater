const clone = require('just-clone');
const log = require('./logger');

function getLocalDate() {
  const time = new Date().toLocaleTimeString('en-US');
  const date = new Date();
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0'); // January is 0!
  const yyyy = date.getFullYear();

  return `${mm}/${dd}/${yyyy}-${time}`;
}

function createHistoryEntry(action, context) {
  const snapshot = clone(context);
  // We don't want nested history of histories
  delete snapshot.history;
  return {
    action,
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

function getUpdatedHistory(history, action, context) {
  let existingHistory = [];
  if (Array.isArray(history)) {
    existingHistory = clone(history);
  }
  existingHistory.push(createHistoryEntry(action, context));
  logHistory(existingHistory);
  return existingHistory;
}

module.exports = {
  getUpdatedHistory,
};
