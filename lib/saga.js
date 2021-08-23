const { inspect } = require('util');
const clone = require('just-clone');
const log = require('./logger');
const { getUpdatedHistory } = require('./history');

let countId = 0;

function getId() {
  countId += 1;
  return countId;
}

function logSagaResults({
  successful, unsuccessful, action, id,
}) {
  log.debug(`Logging result for "${action}" <id: ${id}>`);
  let failedMessage = '';
  unsuccessful.forEach(({ error, context: { archivePath } }, index) => {
    failedMessage += `Failed converting ${index + 1}/${unsuccessful.length} "${archivePath}" because of:\n ${error.stack || error}\n`;
  });
  log.info(`Successful "${action}": ${successful.length}`);
  if (unsuccessful.length !== 0) {
    log.error(`Failed: ${unsuccessful.length}\n  ${failedMessage}`);
  } else {
    log.info(`Finished "${action}" successfully. No failures.`);
  }
}

function logContext(context) {
  const message = `Context at the point of "${context.action}" for "${context.archivePath}":\n${inspect(context || {}, { depth: null })}"`;
  log.debug(message);
  if (context.error) {
    log.error(context.error.stack);
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


// async function getSubSagaResults({ successful }, history) {
//   // const results = await getResults(action, arr, getResult, onFail);
//   successful.forEach((context) => {
//     context.history.unshift(...history);
//   });
//   return { successful };
// }

function handleSubSagas(oldSuccessful, oldUnsuccessful, context) {
  const newContext = clone(context);
  let successful = oldSuccessful;
  let unsuccessful = oldUnsuccessful;
  if (newContext.subSagaResults) {
    newContext.subSagaResults.successful.forEach((c) => {
      c.history.unshift(...newContext.history);
    });
    successful = oldSuccessful.concat(newContext.subSagaResults.successful);
    unsuccessful = oldUnsuccessful.concat(newContext.subSagaResults.unsuccessful);
    delete newContext.subSagaResults;
  }
  return {
    successful,
    unsuccessful,
  };
}

async function getResults(action, arr, getResult, onFail = (context) => context) {
  let successful = [];
  let unsuccessful = [];
  const id = getId();
  async function internalCallback(context) {
    let contextResponse;
    try {
      contextResponse = await getResult(context);
      contextResponse.history = getUpdatedHistory(
        contextResponse.history,
        action,
        context,
        contextResponse.recordChange,
      );
      validateResultingContext(context, contextResponse);
      successful.push(contextResponse);
    } catch (error) {
      const failedContext = await onFail(context, error);
      contextResponse = { error, context: failedContext };
      unsuccessful.push(context);
    }
    const updatedResultSet = handleSubSagas(successful, unsuccessful, contextResponse);
    logContext(contextResponse);
    successful = updatedResultSet.successful;
    unsuccessful = updatedResultSet.unsuccessful;
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
