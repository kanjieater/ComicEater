const { inspect } = require('util');
const pLimit = require('p-limit');

const clone = require('just-clone');
const log = require('./logger');
const { getUpdatedHistory } = require('./history');
const { getCPULimit } = require('./utils');

let countId = 0;

function getId() {
  countId += 1;
  return countId;
}

function getUnexpectedFilesLog(contexts) {
  let unexpectedFiles = [];
  contexts.forEach((context) => {
    const unexpectedCount = context?.unexpected?.length;
    if (unexpectedCount === undefined || unexpectedCount <= 0) {
      return;
    }
    unexpectedFiles = unexpectedFiles.concat(context.unexpectedFiles);
  });
  if (unexpectedFiles.length !== 0) {
    return `The following unexpected archive contents were found while extracting:
    "${inspect(unexpectedFiles)}"
    They were successfully added to the new archive with all other valid content. Consider adding these file names to the filesToAllow or filesToDelete in your config file to not see this message in the future.
  `;
  }
  return '';
}

function getResultLog({
  successful, unsuccessful, action, id,
}) {
  const debugMsg = `Getting log message for "${action}" <id: ${id}>`;
  const infoMsg = `Successful "${action}": ${successful.length}`;
  const unexpectedFilesMsg = getUnexpectedFilesLog(successful);
  let finalInfoMsg = '';
  let errorMsg = '';
  unsuccessful.forEach(({ error, archivePath }, index) => {
    errorMsg += `Failed converting ${index + 1}/${unsuccessful.length} "${archivePath}" because of:\n ${error.stack || error}\n`;
  });
  if (unsuccessful.length !== 0) {
    errorMsg = `Failed: ${unsuccessful.length}\n  ${errorMsg}`;
  } else {
    finalInfoMsg = `Finished "${action}" successfully. No failures.`;
  }
  return [{
    debug: debugMsg,
  }, {
    info: infoMsg,
  }, {
    error: errorMsg,
  }, {
  }, {
    warn: unexpectedFilesMsg,
  }, {
    info: finalInfoMsg,
  }];
}

function logByLevel(logLevels) {
  logLevels.forEach((logLevel) => {
    Object.entries(logLevel).forEach(([level, msg]) => {
      if (msg) {
        log[level](msg);
      }
    });
  });
}

function logSagaResults(results) {
  logByLevel(getResultLog(results));
}

function logContext(context) {
  const message = `Context at the point of "${context.action}" for "${context.archivePath}":\n${inspect(context || {}, { depth: null })}"`;
  // TODO enable at log.silly level
  // log.debug(message);
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

class SubSagaError extends Error {
  constructor(message = '', subSagaResults, ...args) {
    if (!subSagaResults) {
      throw new Error('Sub Sagas must pass along their child\'s results.');
    }
    super(message, ...args);
    this.message = `The Sub Saga failed: ${message}`;
    this.subSagaResults = subSagaResults;
  }
}

function handleSubSagas(oldSuccessful, oldUnsuccessful, context) {
  const newContext = clone(context);
  let successful = oldSuccessful;
  let unsuccessful = oldUnsuccessful;
  let hadSubSagaError = false;
  if (context.error instanceof SubSagaError) {
    hadSubSagaError = true;
    newContext.subSagaResults = newContext.error.subSagaResults;
  }
  if (newContext.subSagaResults || hadSubSagaError) {
    if (!hadSubSagaError) {
      newContext.subSagaResults.successful.forEach((c) => {
        c.history.unshift(...newContext.history);
      });
    }
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
      contextResponse = { ...failedContext, error };
      unsuccessful.push(contextResponse);
    }
    const updatedResultSet = handleSubSagas(successful, unsuccessful, contextResponse);
    logContext(contextResponse);
    successful = updatedResultSet.successful;
    unsuccessful = updatedResultSet.unsuccessful;
  }
  if (!Array.isArray(arr)) {
    throw new Error(`Failed to start saga: "${action}" - An array must be provided`);
  }
  const concurrencyLimit = getCPULimit(); //8; // getCPULimit() / 4;  getCPULimit() / 2;
  const limit = pLimit(concurrencyLimit);

  await Promise.all(
    arr.map(
      async (context, i, array) => limit(
        async () => {
          log.info(`${i + 1}/${array.length} "${action}" running in saga <id:${id}>`);
          log.debug(`Starting saga for a batch of ${concurrencyLimit} in <id:${id}>: "${action}"`);
          const result = await internalCallback(context);
          log.info(`${i + 1}/${array.length} "${action}" finished in saga <id:${id}>`);
          return result;
        },
      ),
    ),
  );
  log.info(`Finished saga ${id}: "${action}"`);

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
  SubSagaError,
  logByLevel,
  getResultLog,
};
