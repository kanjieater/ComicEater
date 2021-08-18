const glob = require('fast-glob');
// const fs = require('fs').promises;
const path = require('path');
const fs = require('fs');
const spawn = require('await-spawn');
const archiver = require('archiver');

const image = require('./image');

const {
  log, isWin, rm, checkIsFile,
} = require('./utils');

async function extractRar(archive, extractPath) {
  return extractPath;
}

async function extractZip(archive, extractPath) {
  return extractPath;
}

async function extract7z(archivePath, extractPath) {
  let sevenZip;
  if (!isWin()) {
    // https://sevenzip.osdn.jp/chm/cmdline/switches/overwrite.htm
    // -aoa overwrite
    try {
      sevenZip = await spawn('7z', ['x', archivePath, '-aos', `-o${extractPath}/`]);
      log(sevenZip.toString(), 'debug');
    } catch (e) {
      throw new Error(e.stderr.toString());
    }
  }

  return extractPath;
}

const strategies = {
  '.rar': extract7z,
  '.cbr': extract7z,
  '.zip': extract7z,
  '.7z': extract7z,
};

async function validateArchive(archivePath) {
  log(`Validating archive "${archivePath}"`, 'debug');
  if (!isWin()) {
    try {
      const sevenZip = await spawn('7z', ['t', archivePath]);
      log(sevenZip.toString(), 'debug');
    } catch (e) {
      throw new Error(`Failed archive validation for "${archivePath}"\n "${e.stderr.toString()}"`);
    }
  }
}

function zipDirectory(source, fullZipFilePath) {
  const archive = archiver('zip', { zlib: { level: 0 } });
  const stream = fs.createWriteStream(fullZipFilePath);

  return new Promise((resolve, reject) => {
    archive
      .directory(source, false)
      .on('error', (err) => reject(err))
      .pipe(stream);
    stream.on('close', () => resolve());
    archive.finalize();
  });
}

function getPathData(archivePath) {
  return {
    ext: path.extname(archivePath),
    fileName: path.basename(archivePath, path.extname(archivePath)),
    dir: path.dirname(archivePath),
  };
}

function changeExtension(filePath, ext = 'cbz') {
  log(`Renaming to "${filePath}" to ${ext}`, 'info');
}

// Must return the directory they extracted to
async function extractArchiveInPlace(archivePath) {
  const { ext, dir, fileName } = getPathData(archivePath);
  const extractPath = `${dir}/${fileName}/`;
  if (strategies[ext]) {
    log(`Extracting "${extractPath}"`, 'info');
    return strategies[ext](archivePath, extractPath);
  }
  log(`Extension not supported for "${archivePath}"`, 'warn');
  return null;
}

function zipArchive(dirToArchive, { fileName, dir }) {
  const fullZipPath = `${dir}/${fileName}.cbz`;
  log(`Zipping ${fullZipPath}`, 'info');
  return zipDirectory(dirToArchive, fullZipPath)
    .then(() => fullZipPath);
}

async function checkIfFileExists(filePath) {
  return fs.promises.access(filePath, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

function getNewFilePath(archivePath, newExt) {
  const { fileName, dir } = getPathData(archivePath);
  const newFilePath = `${dir}/${fileName}.${newExt}`;
  log(`New file would be: "${newFilePath}"`, 'debug');
  return newFilePath;
}

async function validateContents(extractedArchiveDir) {
  return image.validateImageDir(extractedArchiveDir);
}

async function convertToCBZ(archivePath) {
  const pathData = getPathData(archivePath);
  const newFilePath = getNewFilePath(archivePath, 'cbz');
  if (await checkIfFileExists(newFilePath)) {
    log(`"${archivePath}" already exists. Skipping.`, 'info');
    // return Promise.reject(new Error('Archive already exists'));
    return newFilePath;
  }
  await validateArchive(archivePath);

  const extractedArchiveDir = await extractArchiveInPlace(archivePath);

  const hasValidContents = await validateContents(extractedArchiveDir);
  if (!hasValidContents) {
    throw new Error(`Corrupted Images found for "${archivePath}"`);
  }

  if (extractedArchiveDir && hasValidContents) {
    const newZipPath = await zipArchive(extractedArchiveDir, pathData);
    // const newArchivePath = changeExtension(newZipPath);
    await validateArchive(newZipPath);
    // Delete the original if we got an extracted and rezipped on
    rm(extractedArchiveDir, false);
    rm(archivePath, false);
    return newZipPath;
  }
  // log(dir);
  return Promise.reject(new Error('Failed to convert to CBZ'));
}

async function convertToCBZBatch(archivePaths) {
  const converted = [];
  const unconverted = [];

  await Promise.all(archivePaths.map(
    async (archivePath) => convertToCBZ(archivePath)
      .then((newArchivePath) => converted.push(newArchivePath))
      .catch((error) => unconverted.push({ error, archivePath })),
  ));

  let failedMessage = '';
  unconverted.forEach(({ error, archivePath }, index) => {
    failedMessage += `Failed converting ${index + 1}/${unconverted.length} "${archivePath}" because of: ${error}\n`;
  });
  log(`Converted ${converted.length}.
  Failed: ${unconverted.length} 
  ${failedMessage}`, 'info');
}

async function getArchives(startPath) {
  let globPath = `${startPath}/**/*.{7z,rar,zip,cbr}`;
  try {
    const isFile = await checkIsFile(startPath);
    if (isFile) {
      globPath = startPath;
    }
  } catch (e) {
    if (e instanceof TypeError) {
      // pass and try globbing
    } else {
      throw e;
    }
  }

  log(`Looking for ${globPath}`, 'debug');
  return glob(glob.escapePath(globPath));
}

module.exports = {
  convertToCBZ,
  convertToCBZBatch,
  getArchives,
};
