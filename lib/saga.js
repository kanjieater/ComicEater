const { inspect } = require('util');
const log = require('./logger');
const { getUpdatedHistory } = require('./history');

let countId = 0;

function getId() {
  countId += 1;
  return countId;
}

function logSagaResults({ successful, unsuccessful, action, id}) {
  log.debug(`Logging result for "${action}" <id: ${id}>`);
  let failedMessage = '';
  unsuccessful.forEach(({ error, context: { archivePath } }, index) => {
    failedMessage += `Failed converting ${index + 1}/${unsuccessful.length} "${archivePath}" because of:\n ${error.stack}\n`;
  });
  log.info(`Successful "${action}": ${successful.length}`);
  if (unsuccessful.length !== 0) {
    log.error(`Failed: ${unsuccessful.length}\n  ${failedMessage}`);
  } else {
    log.info(`Finished "${action}" successfully. No failures.`);
  }
}

function logContext(context, error) {
  const message = `Context at the point of "${context.action}" for "${context.archivePath}":\n${inspect(context || {}, { depth: null })}"`;
  log.debug(message);
  if (error) {
    log.error(error.stack);
  }
}

function validateResultingContext(originalContext, resultingContext) {
  const hasProp = Object.prototype.hasOwnProperty;
  if (!hasProp.call(resultingContext, 'action') && !resultingContext.action) {
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
  const id = getId();
  async function internalCallback(context) {
    try {
      const resultingContext = await getResult(context);
      resultingContext.history = getUpdatedHistory(
        resultingContext.history,
        action,
        context,
        resultingContext.recordChange,
      );
      logContext(resultingContext);
      validateResultingContext(context, resultingContext);
      successful.push(resultingContext);
    } catch (error) {
      const contextResponse = await onFail(context, error);
      logContext(contextResponse, error);
      unsuccessful.push({ error, context: contextResponse });
    }
  }
  if (!Array.isArray(arr)) {
    throw new Error(`Failed to start saga: "${action}" - An array must be provided`);
  }
  log.debug(`Starting saga ${id}: "${action}"`);
  await Promise.all(arr.map(async (context) => internalCallback(context)));
  log.debug(`Finished saga ${id}: "${action}"`);
  return {
    successful,
    unsuccessful,
    action,
    id,
  };
}

module.exports = {
  getResults,
  logSagaResults,
};
