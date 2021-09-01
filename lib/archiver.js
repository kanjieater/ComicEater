const glob = require('fast-glob');
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const archiver = require('archiver');

const log = require('./logger');
const { validateImageDir, getImages } = require('./image');
const {
  rm, moveFile, checkPathExists, removeEmptyDirs,
} = require('./files');
const { getResults, logSagaResults, SubSagaError } = require('./saga');

const {
  isWin, getPathData,
} = require('./utils');
const { removeJunk } = require('./seriesFinder');

const CONVERT_TO_CBZ = 'Convert to CBZ';
const CONVERT_NESTED_TO_CBZ = 'Convert Nested Archives to CBZ';
const CONVERT_FOLDER_TO_CBZ = 'Convert Image Folder to CBZ';
const actions = {
  CONVERT_TO_CBZ,
};

function wrapInQuotes(str) {
  // return `${str.replace(/ /g, '%')}`;
  return `"${str}"`;
}

async function callProgram(command, params = []) {
  // TODO figure out why spawn doesn't work with quoted paths... resorting to exec
  if (isWin()) {
    throw new Error('Windows commands are not yet supported');
  }
  log.debug(`Running command: "${command} ${params.join(' ')}"`);
  await exec(`${command} ${params.join(' ')}`);
}

async function validate7Zip(archivePath) {
  try {
    await callProgram('7z', [
      't',
      wrapInQuotes(archivePath),
    ]);
  } catch (e) {
    throw new Error(`Failed archive validation for "${archivePath}"\n "${e.stack}"`);
  }
}

async function validateRar(archivePath) {
  try {
    await callProgram('unrar', [
      't',
      wrapInQuotes(archivePath),
    ]);
  } catch (e) {
    throw new Error(`Failed archive validation for "${archivePath}"\n "${e.stack}"`);
  }
}

async function extractFileFromArchive(internalFilePath, archivePath, extractPath) {
  await validate7Zip(archivePath);
  await callProgram('7z', [
    'e',
    wrapInQuotes(archivePath),
    '-aoa',
    wrapInQuotes(`-o${extractPath}`),
    wrapInQuotes(internalFilePath),
  ]);
  return `${extractPath}${internalFilePath}`;
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

async function extractRar(archivePath, extractPath) {
  await validateRar(archivePath);
  await callProgram('unrar', [
    'x',
    '-p-', // Do not query password
    '-r', // recurse subdirectories, but this doesn't seem like it does anything
    '-y', // assume yes
    '-o-', // Don't overwrite existing files
    wrapInQuotes(archivePath),
    wrapInQuotes(extractPath),
  ]);
  return extractPath;
}

async function extract7z(archivePath, extractPath) {
  await validate7Zip(archivePath);
  await callProgram('7z', [
    'x',
    wrapInQuotes(archivePath),
    '-aos', // Skip extracting of existing files.
    wrapInQuotes(`-o${extractPath}`),
  ]);
  return extractPath;
}

async function addDirToArchive(localDir, archivePath) {
  await validate7Zip(archivePath);
  await callProgram('7z', [
    'a',
    wrapInQuotes(archivePath),
    wrapInQuotes(`${localDir}*`),
  ]);
  return archivePath;
}

const strategies = {
  '.rar': extractRar,
  '.7z': extract7z,
};

async function getVolumes(startPath) {
  // const cleanFilePath = getNewFilePath('Some new neseted volume path', 'cbz');
  // targetPath = getRootArchivePath(rootPath, cleanFilePath);
  return [];
  return [{
    extractedArchiveDir: '/mnt/w/collection/series queue/Yoshinaga gargoyle 01-02e/Yoshinaga gargoyle 01-02e/[田口仙年堂] 吉永さん家のガーゴイル 第01巻/',
    targetPath: '/mnt/w/collection/series queue/Yoshinaga gargoyle 01-02e/[田口仙年堂] 吉永さん家のガーゴイル 第01巻.cbz',
  },
  {
    extractedArchiveDir: '/mnt/w/collection/series queue/Yoshinaga gargoyle 01-02e/Yoshinaga gargoyle 01-02e/[田口仙年堂] 吉永さん家のガーゴイル 第02巻/',
    targetPath: '/mnt/w/collection/series queue/Yoshinaga gargoyle 01-02e/[田口仙年堂] 吉永さん家のガーゴイル 第02巻.cbz',
  }];
  // return {
  //   extractedArchiveDir, // subfolder where images are
  //   rootPath, // archive to put things in to start with
  //   targetPath, // archive to move things to
  // };
}

async function getArchives(startPath, extensions = ['7z', 'rar', 'zip', 'cbr', 'cbz'], context = {}) {
  const escapedStartPath = glob.escapePath(startPath);
  let format = `{${extensions.join(',')}}`;
  if (extensions.length === 1) {
    [format] = extensions;
  }
  let globPath = `${escapedStartPath}**/*.${format}`;
  try {
    const lstat = await fs.promises.lstat(startPath);
    const isFile = lstat.isFile();
    if (isFile) {
      globPath = escapedStartPath;
    }
  } catch (e) {
    if (e instanceof TypeError) {
      // pass and try globbing
      log.info("File wasn't found, but will still try to glob");
    } else {
      throw e;
    }
  }

  log.debug(`Looking for ${globPath}`);
  const archives = await glob(globPath);
  return archives.map((archivePath) => ({ ...context, archivePath }));
}

async function validateArchive(archivePath) {
  log.debug(`Validating archive "${archivePath}"`);
  let archiveMethod = null;
  try {
    await validate7Zip(archivePath);
    archiveMethod = '.7z';
  } catch (e) {
    // 7zip can handle everything even rars - so it's usually the better option...
    // BUT. Sometimes it can't validate things that unrar can.🤢
    try {
      await validateRar(archivePath);
      archiveMethod = '.rar';
    } catch (rarError) {
      // If it fails just pass out the original 7z error. It's good enough.
      log.warn(rarError);
      throw new Error(`Failed archive validation for "${archivePath}"\n "${e.stack}"`);
    }
  }
  return archiveMethod;
}

async function getFiles(startPath, fileNames) {
  const globPath = `${startPath}**/(${fileNames.join('|')})`;
  return glob(globPath);
}

async function removeFilesToDelete(extractedDir, filesToDelete) {
  const filesToDeletePaths = await getFiles(extractedDir, filesToDelete);
  return Promise.all(
    filesToDeletePaths.map(async (filePath) => rm(filePath, true)),
  );
}

async function cleanArchiveContents(originalDir, { filesToDelete, junkToFilter, filesToAllow }) {
  await removeFilesToDelete(originalDir, filesToDelete);
  const allFiles = await glob(`${originalDir}**/*`);
  const allCleanedFiles = allFiles.map((filePath) => removeJunk(filePath, junkToFilter));
  const cleanedExtractedDir = `${removeJunk(originalDir, junkToFilter)}/`;

  const zippedFromTo = allFiles.map(
    (originalFilePath, i) => [originalFilePath, allCleanedFiles[i]],
  );
  await Promise.all(
    zippedFromTo.map(async ([from, to]) => moveFile(from, to)),
  );
  const allowedFiles = await getFiles(cleanedExtractedDir, filesToAllow);
  const imagePaths = await getImages(cleanedExtractedDir);
  const archives = await getArchives(cleanedExtractedDir);
  const archivePaths = archives.map(({ archivePath }) => archivePath);
  if (imagePaths.length === 0 && archivePaths.length === 0) {
    throw new Error(`No images were detected in ${originalDir}`);
  }
  const cleanedAllowedFiles = [...imagePaths, ...archivePaths, ...allowedFiles];
  const unexpectedFiles = allCleanedFiles.filter(
    (filePath) => !cleanedAllowedFiles.includes(filePath),
  );

  return {
    extractedArchiveDir: cleanedExtractedDir,
    unexpectedFiles,
  };
}

// Must return the directory they extracted to
async function extractArchiveInPlace(archivePath, validArchiveType) {
  const { dir, fileName } = getPathData(archivePath);
  const extractPath = `${dir}/${fileName}/`;
  log.info(`Extracting "${extractPath}"`);
  return strategies[validArchiveType](archivePath, extractPath);
}

async function zipArchive(dirToArchive, archivePath) {
  const { fileName, dir } = getPathData(archivePath);
  const fullZipPath = `${dir}/${fileName}.cbz`;
  const contentExists = (await glob(`${dirToArchive}**/*`)).length > 0;
  if (!contentExists) {
    throw new Error(`The path "${dirToArchive}" did not have any content in it.`);
  }
  log.info(`Zipping ${fullZipPath}`);
  await zipDirectory(dirToArchive, fullZipPath);
  return fullZipPath;
}

function getNewFilePath(archivePath, newExt) {
  const { fileName, dir } = getPathData(archivePath);
  const newFilePath = `${dir}/${fileName}.${newExt}`;

  log.debug(`New file would be: "${newFilePath}"`);
  return newFilePath;
}

async function validateContents(extractedArchiveDir, originalArchivePath) {
  const hasValidContents = validateImageDir(extractedArchiveDir);
  if (!hasValidContents) {
    throw new Error(`Corrupted Images found for "${originalArchivePath}"`);
  }
}

async function zipAndMove(
  extractedArchiveDir, cleanedArchivePath, targetPath, originalArchivePath,
) {
  const zippedPath = await zipArchive(extractedArchiveDir, cleanedArchivePath);
  await validateArchive(zippedPath);

  const pathExists = await checkPathExists(targetPath);
  if (!pathExists) {
    await moveFile(zippedPath, targetPath);
    if (originalArchivePath) {
      await rm(originalArchivePath, false);
    }
  } else if (targetPath === zippedPath && originalArchivePath) {
    await rm(originalArchivePath, false);
  }
  await rm(extractedArchiveDir, false);
}

async function convertCBZToZip(archivePath, pathAsZip) {
  const { ext } = getPathData(archivePath);
  if (ext === '.cbz') {
    await moveFile(archivePath, pathAsZip);
    return pathAsZip;
  }
  return archivePath;
}

async function convertFolderToCBZ(context) {
  const { extractedArchiveDir, targetPath } = context;
  await zipAndMove(
    extractedArchiveDir, // subfolder where images are
    targetPath, // archive to put things in to start with
    targetPath, // archive to move things to
  );
  return {
    ...context,
    archivePath: targetPath,
    action: CONVERT_FOLDER_TO_CBZ,
    recordChange: true,
  };
}

async function startNestedArchivesSaga(archivePaths) {
  log.debug(`${archivePaths.length} nested archives found in: "${archivePaths}\n ${util.inspect(archivePaths)}"`);
  // Start the recursion
  // eslint-disable-next-line no-use-before-define
  const results = await convertToCBZBatch(archivePaths, CONVERT_NESTED_TO_CBZ);
  logSagaResults(results);
  return results;
}

async function startNestedVolumesSaga(volumePaths) {
  log.debug(`${volumePaths.length} nested volumes found in: "${volumePaths}\n ${util.inspect(volumePaths)}"`);
  // eslint-disable-next-line no-use-before-define
  const results = await convertFoldersToCBZBatch(volumePaths);
  logSagaResults(results);
  return results;
}

async function getNestedArchivePaths(extractedArchiveDir, rootPath, context) {
  log.debug(`Checking for nested archives in: "${extractedArchiveDir}"`);
  const archivePaths = await getArchives(extractedArchiveDir);
  const updatedArchivePaths = archivePaths.map((archiveContext) => ({
    ...context,
    ...archiveContext,
    rootPath,
  }));
  return updatedArchivePaths;
}

async function getNestedVolumesPaths(extractedArchiveDir, rootPath, context) {
  log.debug(`Checking for nested volumes in: "${extractedArchiveDir}"`);
  const volumePaths = await getVolumes(extractedArchiveDir);
  const updatedVolumePaths = volumePaths.map((volumeContext) => ({
    ...context,
    ...volumeContext,
    rootPath,
  }));
  return updatedVolumePaths;
}

async function getNestedArchives(extractedArchiveDir, rootPath, context) {
  const nestedArchives = await getNestedArchivePaths(extractedArchiveDir, rootPath, context);
  let wasNested = true;
  let nestedArchivesResult;
  if (nestedArchives.length) {
    nestedArchivesResult = await startNestedArchivesSaga(nestedArchives);
  } else {
    log.debug(`No nested archives found in: "${extractedArchiveDir}"`);
    wasNested = false;
  }
  return { nestedArchivesResult, directChildren: nestedArchives, wasNested };
}

async function getNestedVolumes(extractedArchiveDir, rootPath, context) {
  const nestedVolumes = await getNestedVolumesPaths(extractedArchiveDir, rootPath, context);
  let wasNested = true;
  let nestedVolumesResult;
  if (nestedVolumes.length > 1) {
    nestedVolumesResult = await startNestedVolumesSaga(nestedVolumes);
  } else {
    log.debug(`No nested volumes found in: "${extractedArchiveDir}"`);
    wasNested = false;
  }
  return {
    nestedVolumesResult,
    directVolumeChildren: nestedVolumes,
    wasNestedVolume: wasNested,
  };
}

function getRootArchivePath(existingRootPath, archivePath) {
  if (existingRootPath) {
    const { fileName } = getPathData(archivePath);
    const { dir } = getPathData(existingRootPath);
    return `${dir}/${fileName}.cbz`;
  }
  return archivePath;
}

async function cleanUpNestedArchive(context, extractedArchiveDir, originalArchive) {
  if (context.subSagaResults.unsuccessful.length !== 0) {
    throw new SubSagaError(
      `Child archive failed so the parent archive will not be removed. ${context.archivePath}`,
      context.subSagaResults,
    );
  }
  await rm(originalArchive, false);
  await removeEmptyDirs(extractedArchiveDir);
}

async function cleanUpNestedVolume(context, extractedArchiveDir, originalArchive) {
  if (context.subSagaResults.unsuccessful.length !== 0) {
    throw new SubSagaError(
      `Child volume failed so the parent folder will not be removed. ${context.archivePath}`,
      context.subSagaResults,
    );
  }
  await rm(originalArchive, false);
  await removeEmptyDirs(extractedArchiveDir);
}

async function convertToCBZ(context) {
  const {
    archivePath, rootPath, junkToFilter,
  } = context;
  const originalArchive = await convertCBZToZip(archivePath, getNewFilePath(archivePath, 'zip'));
  const cleanFilePath = removeJunk(originalArchive, junkToFilter);
  const newFilePath = getNewFilePath(cleanFilePath, 'cbz');
  const updatedContext = { ...context, action: CONVERT_TO_CBZ, recordChange: false };
  if (await checkPathExists(newFilePath)) {
    log.info(`"${originalArchive}" already exists. Skipping.`);
    return { ...updatedContext, originalArchive: newFilePath };
  }
  const validArchiveType = await validateArchive(originalArchive);
  const originalExtractedArchiveDir = await extractArchiveInPlace(
    originalArchive,
    validArchiveType,
  );
  const {
    extractedArchiveDir,
    unexpectedFiles,
  } = await cleanArchiveContents(originalExtractedArchiveDir, context);
  if (!extractedArchiveDir) {
    throw new Error(`Could not extract "${originalArchive}"`);
  }

  const {
    nestedArchivesResult,
    directChildren,
    wasNested,
  } = await getNestedArchives(
    extractedArchiveDir,
    rootPath || cleanFilePath,
    context,
  );

  let targetPath = null;
  if (wasNested) {
    targetPath = extractedArchiveDir;
    updatedContext.rootPath = getRootArchivePath(rootPath, cleanFilePath);
    updatedContext.subSagaResults = nestedArchivesResult;
    updatedContext.directChildren = directChildren;
    await cleanUpNestedArchive(updatedContext, extractedArchiveDir, originalArchive);
  } else {
    targetPath = getRootArchivePath(rootPath, newFilePath);
    await validateContents(extractedArchiveDir, originalArchive);
    const {
      nestedVolumesResult,
      directVolumeChildren,
      wasNestedVolume,
    } = await getNestedVolumes(
      extractedArchiveDir,
      rootPath || cleanFilePath,
      context,
    );
    if (wasNestedVolume) {
      updatedContext.rootPath = getRootArchivePath(rootPath, cleanFilePath);
      updatedContext.subSagaResults = nestedVolumesResult;
      updatedContext.directChildren = directVolumeChildren;
      await cleanUpNestedVolume(updatedContext, extractedArchiveDir, originalArchive);
    } else {
      await zipAndMove(
        extractedArchiveDir,
        cleanFilePath,
        targetPath,
        originalArchive,
      );
    }
  }

  return {
    ...updatedContext,
    archivePath: targetPath,
    originalArchivePath: archivePath,
    unexpectedFiles,
    recordChange: true,
  };
}

function getFilteredOutNested(contexts) {
  const flatChildren = contexts.filter((context) => !context.directChildren);
  return flatChildren;
}

async function convertToCBZBatch(archivePaths, action = CONVERT_TO_CBZ) {
  const results = await getResults(action, archivePaths, convertToCBZ);
  return results;
}

async function convertFoldersToCBZBatch(folderPaths) {
  const results = await getResults(CONVERT_FOLDER_TO_CBZ, folderPaths, convertFolderToCBZ);
  return results;
}

module.exports = {
  convertToCBZ,
  convertToCBZBatch,
  getArchives,
  addDirToArchive,
  extractFileFromArchive,
  getFilteredOutNested,
  actions,
};
