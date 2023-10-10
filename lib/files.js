const fg = require('fast-glob');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const pLimit = require('p-limit');
const log = require('./logger');
const { getPathData, getLocalDate } = require('./utils');
const { getResults } = require('./saga');
const { getCPULimit } = require('./utils');

const LIMIT = pLimit(getCPULimit() * 4);

const CLEAN_UP_SUCCESSFUL = 'Remove Files that Completed Their Work Successfully';
const MOVE_FILES_TO_MAINTENANCE = 'Check Queues and Move Files to Maintenance Folder';
const REMOVE_EMPTY_DIRS = 'Remove Empty Folder';

async function glob(input, options = {}) {
  let escapedInput = '';
  input.forEach(({ raw, escape }) => {
    if (escape !== undefined) {
      escapedInput += fg.escapePath(escape);
    } else if (raw) {
      escapedInput += raw;
    }
  });
  log.debug(`Looking for ${escapedInput}`);
  const baseOptions = { dot: true, caseSensitiveMatch: true };
  return LIMIT(() => fg(escapedInput, { ...baseOptions, ...options }));
}

async function rm(filePath, dryRun = true) {
  log.warn(`Deleting ${filePath}`);
  if (dryRun) {
    return;
  }
  try {
    await LIMIT(() => fs.remove(filePath));
  } catch (err) {
    throw new Error(err);
  }
  log.warn(`Deleted ${filePath}`);
}

async function getChildDirs(dir) {
  return glob([
    { escape: path.resolve(dir) },
    { raw: '/**/*' },
  ], {
    onlyDirectories: true, deep: 1,
  });
}

async function getDirs(dir) {
  return glob([
    { escape: path.resolve(dir) },
    { raw: '/**/*' },
  ], {
    onlyDirectories: true,
  });
}

async function checkPathExists(file) {
  try {
    const exists = await fs.promises
      .access(file, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);
    return exists;
  } catch (e) {
    throw new Error(e);
  }
}

async function removeEmptyDirs(folder, maxPath = '') {
  let isDir = false;
  const pathExists = await checkPathExists(folder);
  try {
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
    if (files.length === 1 && files[0] === 'Thumbs.db') {
      // This is for the edge case on windows where an empty folder
      // Still has a Thumbs.db that the OS hasn't cleaned up yet
      // Otherwise you will have an "empty" folder that it refuses to delete.
      await rm(folder, false);
      return removeEmptyDirs(folder, maxPath);
    }
    await Promise.all(
      files.map(async (file) => {
        const fullPath = path.join(folder, file);
        return removeEmptyDirs(fullPath, maxPath);
      }),
    );

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

// function getTmpPath(filePath) {
//   const { dir, fileName } = getPathData(filePath);
//   const tmpDir = `/tmp${dir}`;
//   const fileDir = `${tmpDir}/${fileName}/`;
//   log.debug(`Identified ${fileDir} as a temporary location`);
//   return { dir: tmpDir, fileDir };
// }

function getTmpPath(filePath) {
  const { dir, fileName } = getPathData(filePath);
  const tmpDir = path.join('/', 'tmp', dir);
  const fileDir = path.join(tmpDir, fileName, '/');
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

async function moveFile(from, to, overwrite = false, shouldLog = true) {
  if (path.resolve(from) === path.resolve(to)) {
    log.debug(`No need to move this file: "${from}"`);
    return from;
  }
  if (shouldLog) {
    log.info(`Moving "${from}" to "${to}"`);
  }
  const pathExists = await checkPathExists(to);
  if (pathExists && !overwrite) {
    throw new Error(
      `Refusing to move ${from}" to "${to}" because it exists already.`,
    );
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
      await removeEmptyDirs(from);
      return to;
    }
    if (e.code === 'EXDEV') {
      // Cross disk moving
      await fs.promises.copyFile(from, to);
      await fs.promises.unlink(from);
      return to;
    }
    throw new Error(e);
  }
  return response;
}
async function moveFilesBatch(zippedFromTo) {
  return Promise.all(
    zippedFromTo.map(async ([from, to]) => LIMIT(
      async () => moveFile(from, to, false, false),
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

async function removeDirsSaga(context) {
  const queueDirsToRemove = await getChildDirs(context.queuePath);
  const dirsToRemove = [...queueDirsToRemove];
  await Promise.all(dirsToRemove.map(async (dir) => removeEmptyDirs(dir)));
  await removeEmptyDirs(context.maintenanceFolder);

  return {
    ...context,
    action: MOVE_FILES_TO_MAINTENANCE,
    recordChange: false,
  };
}

async function cleanSuccessfulResults(existingResults) {
  const pathsToDelete = {};
  existingResults.successful.forEach((context) => {
    if (context?.deleteIfSuccessful) {
      context.deleteIfSuccessful.forEach((deleteIfSuccessfulPath) => {
        pathsToDelete[deleteIfSuccessfulPath] = context;
      });
    }
  });
  const topLevelPaths = getTopLevelPathContexts(pathsToDelete);
  const topLevelContexts = Object.entries(topLevelPaths).map(
    ([deleteIfSuccessfulPath, context]) => ({
      ...context,
      deleteIfSuccessfulPath,
    }),
  );
  const results = await getResults(
    CLEAN_UP_SUCCESSFUL,
    topLevelContexts,
    cleanPath,
  );
  const rmDirsResults = await getResults(
    REMOVE_EMPTY_DIRS, existingResults.successful, removeDirsSaga,
  );
  results.successful = results.successful.concat(rmDirsResults.successful);
  results.unsuccessful = results.unsuccessful.concat(rmDirsResults.unsuccessful);
  return results;
}

async function moveFileToMaintenance(context) {
  await moveFile(context.filePath, context.maintenancePath, false, false);
  return {
    ...context,
    action: MOVE_FILES_TO_MAINTENANCE,
    recordChange: false,
  };
}

function getCurrentmaintenanceFolder(maintenanceFolder) {
  const date = getLocalDate();
  return `${path.resolve(maintenanceFolder)}/${date}/`;
}

function getMaintenancePath(filePath, dir, queuePath) {
  const relativeFilePath = filePath.replace(queuePath, '');
  const fp = `${dir}/${relativeFilePath}`;
  return fp;
}

async function getAllDirs(folder) {
  return glob([{ escape: path.resolve(folder) }, { raw: '/**/*' }], {
    onlyDirectories: true,
  });
}

async function moveFilesToMaintenanceSaga(contexts) {
  const fileContexts = [];
  contexts.forEach((context) => {
    context.filePaths.forEach((filePath) => {
      fileContexts.push({
        ...context,
        filePath,
        maintenancePath: getMaintenancePath(
          filePath,
          context.maintenanceFolder,
          context.queuePath,
        ),
      });
    });
  });
  const results = await getResults(
    MOVE_FILES_TO_MAINTENANCE,
    fileContexts,
    moveFileToMaintenance,
  );
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
      async (queuePath) => removeEmptyDirs(queuePath, queuePath),
    ),
  );
}

function getWriter(filePath) {
  return fs.createWriteStream(filePath);
}

module.exports = {
  getWriter,
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
  getDirs,
  getCurrentmaintenanceFolder,
  LIMIT,
};
