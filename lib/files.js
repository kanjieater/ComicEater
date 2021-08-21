const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const log = require('./logger');
const { getPathData } = require('./utils');

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
      }
    });
  } catch (e) {
    throw new Error(e);
  }
}

async function removeEmptyDirs(folder) {
  const isDir = (await fs.promises.lstat(folder)).isDirectory();
  if (!isDir) {
    return false;
  }
  let files = await fs.promises.readdir(folder);
  if (files.length > 0) {
    await Promise.all(files.map(async (file) => {
      const fullPath = path.join(folder, file);
      return removeEmptyDirs(fullPath);
    }));

    // re-evaluate files; after deleting subfolder
    // we may have parent folder empty now
    files = await fs.promises.readdir(folder);
  }

  if (files.length === 0) {
    await rm(folder, false);
    return true;
  }
  log.debug(`Has files. Won't delete "${folder}"`);
  return false;
}

function isDirEmpty(dirname) {
  return fs.promises.readdir(dirname).then((files) => files.length === 0);
}

async function removeAllEmptyDirs(dir, max) {
  let currentDir = dir;
  let count = 0;
  let noLimit = false;
  if (!max) {
    noLimit = true;
  }
  return (async () => {
    log.debug(`Attempting to remove ${currentDir}`);
    while (noLimit || count < max) {
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
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  return fs.promises.writeFile(filePath, data);
  // return fs.promises.writeFile(dir, content);
}

async function readFile(filePath) {
  log.debug(`Reading content from ${filePath}`);
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    return await fs.promises.readFile(filePath);
  } catch (e) {
    throw new Error(e);
  }
}

module.exports = {
  removeEmptyDirs,
  isDirEmpty,
  rm,
  removeAllEmptyDirs,
  writeFile,
  getTmpPath,
  readFile,
};
