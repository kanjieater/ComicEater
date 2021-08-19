const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const { log } = require('./logger');

async function rm(filePath, dryRun = true) {
  log(`Deleting ${filePath}`, 'warn');
  return new Promise((resolve, reject) => {
    if (!dryRun) {
      rimraf(filePath, (err) => {
        if (err) {
          reject(err);
        }
        log(`Deleted ${filePath}`, 'warn');
        resolve();
      });
    }
  });
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
  log(`Has files. Won't delete "${folder}"`)
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
    log(`Attempting to remove ${currentDir}`);
    while (noLimit || count < max) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await removeEmptyDirs(currentDir))) {
        break;
      }
      count += 1;
      currentDir = path.join(currentDir, '..');
      log(`Attempting to remove ${currentDir}`);
    }
  })();
}

module.exports = {
  removeEmptyDirs,
  isDirEmpty,
  rm,
  removeAllEmptyDirs,
};
