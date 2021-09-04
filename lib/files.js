const fg = require('fast-glob');
const fs = require('fs-extra');
const path = require('path');
const rimraf = require('rimraf');
const yaml = require('js-yaml');
const pLimit = require('p-limit');
const log = require('./logger');
const { getPathData, getLocalDate } = require('./utils');
const { getResults } = require('./saga');
const { getCPULimit } = require('./utils');

const LIMIT = pLimit(getCPULimit() * 4);

const CLEAN_UP_SUCCESSFUL = 'Remove Files that Completed Their Work Successfully';
const MOVE_FILES_TO_MAINTENANCE = 'Move Files to Maintenance Folder';
const REMOVE_EMPTY_DIRS = 'Remove Empty Folder';

async function glob(input, options) {
  let escapedInput = '';
  input.forEach(({ raw, escape }) => {
    if (escape !== undefined) {
      escapedInput += fg.escapePath(escape);
    } else if (raw) {
      escapedInput += raw;
    }
  });
  const baseOptions = { dot: true, caseSensitiveMatch: false };
  return LIMIT(() => fg(escapedInput, { ...baseOptions, ...options }));
}

async function rm(filePath, dryRun = true) {
  log.warn(`Deleting ${filePath}`);
  try {
    await new Promise((resolve, reject) => {
      if (!dryRun) {
        rimraf(filePath, (err) => {
          if (err) {
            return reject(err);
          }
          log.warn(`Deleted ${filePath}`);
          return resolve();
        });
      } else {
        resolve();
      }
    });
  } catch (e) {
    throw new Error(e);
  }
}

async function getChildDirs(dir) {
  return glob([
    { escape: path.resolve(dir) },
    { raw: '/**/*' },
  ], {
    onlyDirectories: true, deep: 1,
  });
}

async function checkPathExists(file) {
  try {
    const exists = await fs.promises.access(file, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);
    return exists;
  } catch (e) {
    throw new Error(e);
  }
}

async function removeEmptyDirs(folder, maxPath = '') {
  let isDir = false;
  try {
    const pathExists = await checkPathExists(folder);
    if (pathExists) {
      isDir = (await fs.promises.lstat(folder)).isDirectory();
    }
  } catch (e) {
    throw new Error(e);
  }
  if (!isDir) {
    return false;
  }
  let files = await fs.promises.readdir(folder);
  if (files.length > 0) {
    await Promise.all(files.map(
      async (file) => LIMIT(
        async () => {
          const fullPath = path.join(folder, file);
          return removeEmptyDirs(fullPath, maxPath);
        },
      ),
    ));

    // re-evaluate files; after deleting subfolder
    // we may have parent folder empty now
    try {
      files = await fs.promises.readdir(folder);
    } catch (e) {
      throw new Error(e);
    }
  }

  if (path.resolve(maxPath) === path.resolve(folder)) {
    log.debug(`Deleted empty folders up to "${maxPath}"`);
    return false;
  }

  if (files.length === 0) {
    await rm(folder, false);
    return true;
  }
  log.debug(`Has files. Won't delete "${folder}"`);
  return false;
}

// Let's promises run away! Investiage usage!
async function removeAllEmptyDirs(dir, maxPath, max) {
  let currentDir = dir;
  const rootPath = path.resolve(maxPath);
  let count = 0;
  let noLimit = false;
  if (!max) {
    noLimit = true;
  }
  return (async () => {
    log.debug(`Attempting to remove ${currentDir}`);
    while ((noLimit || count < max) && (currentDir !== rootPath)) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await removeEmptyDirs(currentDir))) {
        break;
      }
      count += 1;
      currentDir = path.join(currentDir, '..');
      log.debug(`Attempting to remove ${currentDir}`);
    }
  })();
}

function getTmpPath(filePath) {
  const { dir, fileName } = getPathData(filePath);
  const tmpDir = `/tmp${dir}`;
  const fileDir = `${tmpDir}/${fileName}/`;
  log.debug(`Identified ${fileDir} as a temporary location`);
  return { dir: tmpDir, fileDir };
}

async function writeFile(data, filePath) {
  log.info(`Writing content to ${filePath}`);
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  } catch (e) {
    throw new Error(e);
  }
  return fs.promises.writeFile(filePath, data);
  // return fs.promises.writeFile(dir, content);
}

async function readFile(filePath) {
  log.info(`Reading content from ${filePath}`);
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    return await fs.promises.readFile(filePath);
  } catch (e) {
    throw new Error(e);
  }
}

async function readYMLFile(filePath) {
  log.debug(`Reading YML content from ${filePath}`);
  try {
    return yaml.load(await readFile(filePath));
  } catch (e) {
    throw new Error(e);
  }
}

async function moveFile(from, to, overwrite = false) {
  if (path.resolve(from) === path.resolve(to)) {
    log.debug(`No need to move this file: "${from}"`);
    return from;
  }
  log.info(`Moving "${from}" to "${to}"`);
  const pathExists = await checkPathExists(to);
  if (pathExists && !overwrite) {
    throw new Error(`Refusing to move ${from}" to "${to}" because it exists already.`);
  }
  const { dir } = getPathData(to);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (e) {
    throw new Error(e);
  }
  let response = null;
  try {
    response = await fs.promises.rename(from, to);
  } catch (e) {
    if (e.code === 'ENOTEMPTY') {
      // if the directory already exists somewhere it can fail to move it,
      // so just remove it, since it already exists.
      removeEmptyDirs(from);
      return to;
    }
    throw new Error(e);
  }
  return response;
}
async function moveFilesBatch(zippedFromTo) {
  return Promise.all(
    zippedFromTo.map(async ([from, to]) => LIMIT(
      async () => moveFile(from, to),
    )),
  );
}

async function cleanPath(context) {
  await rm(context.deleteIfSuccessfulPath, false);
  return {
    ...context,
    action: CLEAN_UP_SUCCESSFUL,
    recordChange: false,
  };
}

function getTopLevelPathContexts(pathsToDelete) {
  const topLevelPaths = {};
  Object.entries(pathsToDelete).forEach(([deleteIfSuccessfulPath, context]) => {
    if (Object.keys(topLevelPaths).length === 0) {
      topLevelPaths[deleteIfSuccessfulPath] = context;
    } else {
      let shouldAdd = true;
      Object.keys(topLevelPaths).forEach((topLevelPath) => {
        if (deleteIfSuccessfulPath.includes(topLevelPath)) {
          delete topLevelPaths[topLevelPath];
          topLevelPaths[deleteIfSuccessfulPath] = context;
        }
        if (topLevelPath.includes(deleteIfSuccessfulPath)) {
          shouldAdd = false;
        }
      });
      if (shouldAdd) {
        topLevelPaths[deleteIfSuccessfulPath] = context;
      }
    }
  });
  return topLevelPaths;
}

async function cleanSuccessfulResults(existingResults) {
  let allSuccessful = [];
  existingResults.forEach((results) => {
    allSuccessful = allSuccessful.concat(results.successful);
  });
  const pathsToDelete = {};
  allSuccessful.forEach((context) => {
    if (context?.deleteIfSuccessful) {
      context.deleteIfSuccessful.forEach((deleteIfSuccessfulPath) => {
        pathsToDelete[deleteIfSuccessfulPath] = context;
      });
    }
  });
  const topLevelPaths = getTopLevelPathContexts(pathsToDelete);
  const topLevelContexts = Object.entries(topLevelPaths).map(
    ([deleteIfSuccessfulPath, context]) => ({ ...context, deleteIfSuccessfulPath }),
  );
  const results = await getResults(CLEAN_UP_SUCCESSFUL, topLevelContexts, cleanPath);
  return results;
}

async function moveFileToMaintenance(context) {
  await moveFile(context.filePath, context.targetPath);
  return {
    ...context,
    action: MOVE_FILES_TO_MAINTENANCE,
    recordChange: false,
  };
}

async function removeDirsSaga(context) {
  const dirsToRemove = await getChildDirs(context.queuePath);
  Promise.all(dirsToRemove.map(
    async (dir) => LIMIT(async () => {
      await removeEmptyDirs(dir);
    }),
  ));

  return {
    ...context,
    action: MOVE_FILES_TO_MAINTENANCE,
    recordChange: false,
  };
}

function getBackupTargetFilePath(filePath, maintenanceFolder, queuePath) {
  const relativeFilePath = filePath.replace(queuePath, '');
  const newFilePath = `${path.resolve(maintenanceFolder)}/${getLocalDate(false)}/${relativeFilePath}`;
  return newFilePath;
}

async function getAllDirs(folder) {
  return glob([{ escape: path.resolve(folder) }, { raw: '/**/*' }], { onlyDirectories: true });
}

async function moveFilesToMaintenanceSaga(contexts) {
  const fileContexts = [];
  contexts.forEach((context) => {
    context.filePaths.forEach((filePath) => {
      fileContexts.push({
        ...context,
        filePath,
        targetPath: getBackupTargetFilePath(
          filePath, context.maintenanceFolder, context.queuePath,
        ),
      });
    });
  });
  const results = await getResults(MOVE_FILES_TO_MAINTENANCE, fileContexts, moveFileToMaintenance);
  const rmDirsResults = await getResults(REMOVE_EMPTY_DIRS, contexts, removeDirsSaga);
  results.successful = results.successful.concat(rmDirsResults.successful);
  results.unsuccessful = results.unsuccessful.concat(rmDirsResults.unsuccessful);
  return results;
}

async function getAllFiles(folder) {
  return glob([{ escape: path.resolve(folder) }, { raw: '/**/*' }]);
}

async function cleanQueues(contexts) {
  if (!contexts) {
    return true;
  }
  const allQueues = contexts.map(({ queuePath }) => queuePath);
  const uniqueQueues = [...new Set(allQueues)];

  return Promise.all(
    uniqueQueues.map(
      async (queuePath) => LIMIT(
        async () => removeEmptyDirs(queuePath, queuePath),
      ),
    ),
  );
}

module.exports = {
  removeEmptyDirs,
  rm,
  removeAllEmptyDirs,
  writeFile,
  getTmpPath,
  readFile,
  moveFile,
  moveFilesBatch,
  checkPathExists,
  readYMLFile,
  cleanSuccessfulResults,
  getAllFiles,
  getAllDirs,
  getChildDirs,
  moveFilesToMaintenanceSaga,
  cleanQueues,
  glob,
  LIMIT,
};
