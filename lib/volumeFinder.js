const glob = require('fast-glob');
// const fs = require('fs');
const util = require('util');

const log = require('./logger');
// const { validateImageDir, getImages } = require('./image');
const {
  rm, removeEmptyDirs,
} = require('./files');
const { getResults, logSagaResults, SubSagaError } = require('./saga');

const {
  getPathData,
} = require('./utils');

const { zipAndMove } = require('./command');


const CONVERT_FOLDER_TO_CBZ = 'Convert Image Folder to CBZ';

async function getVolumes(startPath) {
  // const cleanFilePath = getNewFilePath('Some new neseted volume path', 'cbz');
  // targetPath = getRootArchivePath(rootPath, cleanFilePath);
  // return [];
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

async function convertFoldersToCBZBatch(folderPaths) {
  const results = await getResults(CONVERT_FOLDER_TO_CBZ, folderPaths, convertFolderToCBZ);
  return results;
}

async function startNestedVolumesSaga(volumePaths) {
  log.debug(`${volumePaths.length} nested volumes found in: "${volumePaths}\n ${util.inspect(volumePaths)}"`);
  // eslint-disable-next-line no-use-before-define
  const results = await convertFoldersToCBZBatch(volumePaths);
  logSagaResults(results);
  return results;
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

module.exports = {
  getNestedVolumes,
  cleanUpNestedVolume,
  getVolumes,
};
