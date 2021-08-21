const { inspect } = require('util');
const log = require('./logger');
const { getUpdatedHistory } = require('./history');

function logContext(context, error) {
  const message = `Context at the point of "${context.action}" for "${context.archivePath}":\n${inspect(context || {}, { depth: null })}"`;
  log.debug(message);
  if (error) {
    log.error(error.stack);
  }
}

function validateResultingContext(originalContext, resultingContext) {
  const hasProp = Object.prototype.hasOwnProperty;
  if (!hasProp.call(resultingContext, 'action') && resultingContext.action) {
    throw new Error('Saga Broken! "action" was removed!');
  }
  if (!hasProp.call(resultingContext, 'archivePath') && resultingContext.archivePath) {
    throw new Error(`"${resultingContext.action}" Saga Broken! "archivePath" was removed!`);
  }
  if (!hasProp.call(resultingContext, 'recordChange')) {
    throw new Error(`"${resultingContext.action}" Saga Broken! "recordChange" was removed!`);
  }
  if (originalContext.history) {
    const historyWasLost = resultingContext.history.length <= originalContext.history.length;
    if (historyWasLost) {
      throw new Error(`"${resultingContext.action}" Saga Broken! A History entry was removed!`);
    }
  }
}

async function getResults(action, arr, getResult, onFail = (context) => context) {
  const successful = [];
  const unsuccessful = [];
  async function internalCallback(context) {
    try {
      const resultingContext = await getResult(context);
      logContext(resultingContext);
      resultingContext.history = getUpdatedHistory(
        resultingContext.history,
        action,
        context,
        resultingContext.recordChange,
      );
      validateResultingContext(context, resultingContext);
      successful.push(resultingContext);
    } catch (error) {
      const contextResponse = await onFail(context, error);
      logContext(contextResponse, error);
      unsuccessful.push({ error, context: contextResponse });
    }
  }
  log.debug(`Starting saga: "${action}"`);
  await Promise.all(arr.map(async (context) => internalCallback(context)));
  log.debug(`Finished saga: "${action}"`);
  return {
    successful,
    unsuccessful,
    action,
  };
}

module.exports = {
  getResults,
};
