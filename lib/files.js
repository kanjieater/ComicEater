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

async function removeEmptyDirs(folder) {
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
    await Promise.all(files.map(async (file) => {
      const fullPath = path.join(folder, file);
      return removeEmptyDirs(fullPath);
    }));

    // re-evaluate files; after deleting subfolder
    // we may have parent folder empty now
    try {
      files = await fs.promises.readdir(folder);
    } catch (e) {
      throw new Error(e);
    }
  }

  if (files.length === 0) {
    await rm(folder, false);
    return true;
  }
  log.debug(`Has files. Won't delete "${folder}"`);
  return false;
}

// Let's promises run away! Investiage usage!
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

async function moveFile(from, to, overwrite = false) {
  log.info(`Moving "${from}" to "${to}"`);
  const pathExists = await checkPathExists(to);
  if (pathExists && !overwrite) {
    throw new Error(`Did not pass overwrite flag. Refusing to move ${from}" to "${to}" because it exists already.`);
  }
  try {
    return fs.promises.rename(from, to);
  } catch (e) {
    throw new Error(e);
  }
}

module.exports = {
  removeEmptyDirs,
  rm,
  removeAllEmptyDirs,
  writeFile,
  getTmpPath,
  readFile,
  moveFile,
  checkPathExists,
};
