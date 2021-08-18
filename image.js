const fs = require('fs');
const gm = require('gm').subClass({ imageMagick: true });
const glob = require('fast-glob');
const path = require('path');
const { log, rm } = require('./utils');

async function validateImage(imagePath, tmpImagePath) {
  /* TODO: Figure out how to write to dev/null.
  Seems like it only calls out to magick when
  you use write though, and that's what triggers
  the error collection
  */
  const imageName = path.basename(imagePath);
  const tmp = `${tmpImagePath}${imageName}`;
  // log(`Validating Image: ${tmp}`);

  return new Promise((resolve, reject) => gm(imagePath)
    .resize(5, 5)
    .write(tmp, (err) => {
      log(`Validating Image: ${tmp}`);
      if (!err) {
        resolve();
      } else {
        log(`Image Validation resulted in '${err}'`);
        reject(err);
      }
    }));
}

function getImages(startPath) {
  const globPath = `${startPath}**/*.{jpg,jpeg,png,gif,webp,tiff,mng,bmp}`;
  // log(globPath);
  return glob(globPath);
}

async function validateImageDir(dir) {
  const validImages = [];
  const invalidImages = [];
  const imagesPath = await getImages(dir);
  const tmpImagePath = `/tmp${dir}`;
  await fs.promises.mkdir(tmpImagePath, { recursive: true });
  log(`'Validating ${imagesPath} images`, 'info');
  await Promise.all(
    imagesPath.map(async (imagePath) => validateImage(imagePath, tmpImagePath)
      .then(() => validImages.push(imagePath))
      .catch((error) => invalidImages.push({ error, imagePath }))),
  );
  if (invalidImages.length) {
    log(`Invalid images found in ${invalidImages.length}/${imagesPath.length} of "${dir}"`, 'error');
  }
  rm(tmpImagePath, false);

  return !invalidImages.length;
}

module.exports = {
  validateImageDir,
  validateImage,
};
