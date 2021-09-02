const fs = require('fs');
const gm = require('gm').subClass({ imageMagick: true });
const path = require('path');
const log = require('./logger');
const { glob } = require('./utils');
const { rm } = require('./files');

async function validateImage(imagePath, tmpImagePath) {
  /* TODO: Figure out how to write to dev/null.
  Seems like it only calls out to magick when
  you use write though, and that's what triggers
  the error collection
  */
  const imageName = path.basename(imagePath);
  const tmp = `${tmpImagePath}${imageName}`;
  // log.debug(`Validating Image: ${tmp}`);

  return new Promise((resolve, reject) => gm(imagePath)
    .resize(5, 5)
    .write(tmp, (err) => {
      log.debug(`Validating Image: ${tmp}`);
      if (!err) {
        resolve();
      } else {
        log.debug(`Image Validation resulted in '${err}'`);
        reject(err);
      }
    }));
}

async function getImages(startPath) {
  return glob([{ escape: path.resolve(startPath) }, { raw: '/**/*.{jpg,jpeg,png,gif,webp,tiff,mng,bmp}' }]);
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
  if (invalidImages.length) {
    log.error(`Invalid images found in ${invalidImages.length}/${imagesPath.length} of "${dir}"`);
  }
  await rm(tmpImagePath, false);

  return !invalidImages.length;
}

module.exports = {
  validateImageDir,
  validateImage,
  getImages,
};
