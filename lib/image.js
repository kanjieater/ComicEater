const fs = require('fs-extra');

const gm = require('gm').subClass({ imageMagick: true });
const path = require('path');
const pLimit = require('p-limit');
const log = require('./logger');
const { rm, glob } = require('./files');
const { getCPULimit } = require('./utils');

const LIMIT = pLimit(getCPULimit() * 2);

async function resizeTest(imagePath, tmp) {
  return new Promise((resolve, reject) => gm(imagePath)
    .resize(5, 5)
    .write(tmp, (err) => {
      // log.debug(`Validating Image: ${tmp}`); TODO enable as log.silly
      if (!err) {
        resolve();
      } else {
        log.debug(`Image Validation resulted in '${err}'`);
        reject(err);
      }
    }));
}

async function validateImage(imagePath, tmpImagePath) {
  /* TODO: Figure out how to write to dev/null.
  Seems like it only calls out to magick when
  you use write though, and that's what triggers
  the error collection
  */
  const imageName = path.basename(imagePath);
  const tmp = `${tmpImagePath}${imageName}`;
  // log.debug(`Validating Image: ${tmp}`);  TODO enable as log.silly

  const response = await LIMIT(() => resizeTest(imagePath, tmp));
  return response;
}

async function getImages(startPath) {
  return glob([{ escape: path.resolve(startPath) }, { raw: '/**/*.{jpg,jpeg,png,gif,webp,tiff,tif,mng,bmp}' }]);
}

async function validateImageDir(dir) {
  const validImages = [];
  const invalidImages = [];
  const imagesPath = await getImages(dir);
  const tmpImagePath = `/tmp${dir}`;
  await fs.promises.mkdir(tmpImagePath, { recursive: true });
  log.debug(`Validating ${imagesPath} images`);
  await Promise.all(
    imagesPath.map(async (imagePath) => validateImage(imagePath, tmpImagePath)
      .then(() => validImages.push(imagePath))
      .catch((error) => invalidImages.push({ error, imagePath }))),
  );
  const response = {};
  if (invalidImages.length) {
    const errorMessage = `${invalidImages.length}/${imagesPath.length} invalid images found in "${dir}"`;
    log.error(errorMessage);
    response.error = errorMessage;
  }
  await rm(tmpImagePath, false);
  response.isValid = !invalidImages.length;
  return response;
}

async function verifyImageCount(contexts) {
  const [parent] = contexts.slice(0, 1);
  const parentImages = await getImages(parent.volumeStartPath);
  const listOfImagesLists = await Promise.all(
    contexts.slice(1).map(
      async ({ volumeStartPath }) => getImages(volumeStartPath),
    ),
  );
  const childImagesList = [].concat(...listOfImagesLists);
  return parentImages.length === childImagesList.length;
}

async function callTrimImage(imagePath, outputPath) {
  return new Promise((resolve, reject) => gm(imagePath)
    .fuzz('2%')
    .trim()
    .write(outputPath, (err) => {
    // log.debug(`Validating Image: ${tmp}`); TODO enable as log.silly
      if (!err) {
        resolve();
      } else {
        log.debug(`Image Validation resulted in '${err}'`);
        reject(err);
      }
    }));
}

async function trimImagesWhiteSpace(extractedArchiveDir) {
  log.info(`Trimming white space for images in "${extractedArchiveDir}"`);
  const imagePaths = await getImages(extractedArchiveDir);
  await Promise.all(
    imagePaths.map(async (imagePath) => {
      await callTrimImage(imagePath, imagePath);
    }),
  );
  log.info(`Finished trimming white space for images in "${extractedArchiveDir}"`);
}

async function upscaleImages(extractedArchiveDir) {
  log.info(`Upscaling images in "${extractedArchiveDir}"`);
}

async function splitImages(extractedArchiveDir) {
  log.info(`Splitting images in "${extractedArchiveDir}"`);
}

module.exports = {
  trimImagesWhiteSpace,
  upscaleImages,
  splitImages,
  validateImageDir,
  validateImage,
  getImages,
  verifyImageCount,
};
