const fs = require('fs-extra');

const gm = require('gm').subClass({ imageMagick: true });
const path = require('path');
const pLimit = require('p-limit');
const log = require('./logger');
const { rm, glob, getDirs } = require('./files');
const {
  getCPULimit, getPathData, wrapInQuotes, inspect,
} = require('./utils');
const { callProgram, convertWSLToWindowsPath } = require('./command');

const LIMIT = pLimit(getCPULimit() * 2);
const UPSCALE_LIMIT = pLimit(1);
const DOUBLE_PAGE_THRESHOLD = 0.3;
const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'tif', 'mng', 'bmp'];

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
  return glob([{ escape: path.resolve(startPath) }, { raw: `/**/*.{${SUPPORTED_FORMATS.join(',')}}` }]);
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
    const paths = invalidImages.map((invalidImage) => invalidImage.imagePath);
    const errorMessage = `${invalidImages.length}/${imagesPath.length} invalid images found in "${dir}"\n ${inspect(paths)}`;
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
    // .despeckle()
    // .stegano()
    .fuzz('30%')
    .trim()
    .write(outputPath, (err) => {
    // log.debug(`Validating Image: ${tmp}`); TODO enable as log.silly
      if (!err) {
        resolve();
      } else {
        log.debug(`Image Trimming resulted in '${err}'`);
        reject(err);
      }
    }));
}

async function trimImagesWhiteSpace(extractedArchiveDir) {
  log.info(`Trimming white space for images in "${extractedArchiveDir}"`);
  const imagePaths = await getImages(extractedArchiveDir);
  await Promise.all(
    imagePaths.map(
      async (imagePath) => LIMIT(async () => {
        try {
          await callTrimImage(imagePath, imagePath);
        } catch (e) {
          throw new Error(e);
        }
      }),
    ),
  );
  log.info(`Finished trimming white space for images in "${extractedArchiveDir}"`);
}

// async function convertUnsupportedFormat(extractedArchiveDir) {
//   log.info(`Converting unsupported images in "${extractedArchiveDir}"`);
//   const imagePaths = await getImages(extractedArchiveDir);
//   await Promise.all(
//     imagePaths.map(
//       async (imagePath) => LIMIT(async () => {
//         try {
//           await convertImageFormat(imagePath);
//         } catch (e) {
//           throw new Error(e);
//         }
//       }),
//     ),
//   );
//   log.info(`Finished converting to a supported format for "${extractedArchiveDir}"`);
// }

async function upscaleImageDir(imageDir) {
  const wrappedInput = wrapInQuotes(await convertWSLToWindowsPath(imageDir));
  return UPSCALE_LIMIT(
    async () => callProgram('waifu2x-ncnn-vulkan.exe', ['-i', wrappedInput, '-o', wrappedInput, '-n', '2', '-s', '2']),
  );
}

async function upscaleImages(extractedArchiveDir) {
  log.info(`Upscaling images in "${extractedArchiveDir}"`);
  const imageDirs = await getDirs(extractedArchiveDir);
  const imagePaths = await getImages(extractedArchiveDir);
  await Promise.all(imageDirs.map(async (imageDir) => upscaleImageDir(imageDir)));
  await Promise.all(imagePaths.map(async (imagePath) => rm(imagePath, false)));
  const upscaledImages = await getImages(extractedArchiveDir);
  if (upscaledImages.length !== imagePaths.length) {
    throw new Error(`Before and after image count did not match after upscaling "${extractedArchiveDir}"`);
  }
  log.info(`Upscaling images complete for "${extractedArchiveDir}"`);
}

async function getDimensions(imagePath) {
  return new Promise((resolve, reject) => gm(imagePath)
    .size((err, size) => {
      if (!err) {
        resolve({ width: size.width, height: size.height });
      } else {
        log.debug(`Image Validation resulted in '${err}'`);
        reject(err);
      }
    }));
}

function getAverageImageSize(images) {
  const average = (array) => (array.reduce((a, b) => a + b) / array.length);
  return {
    width: average(images.map((image) => image.width)),
    height: average(images.map((image) => image.height)),
  };
}

async function getWideImages(extractedArchiveDir) {
  const imagePaths = await getImages(extractedArchiveDir);
  const imagesWithDimensions = await Promise.all(
    imagePaths.map(
      async (imagePath) => LIMIT(async () => {
        const dimensions = await getDimensions(imagePath, imagePath);
        return {
          imagePath,
          ...dimensions,
        };
      }),
    ),
  );
  const averageDimensions = getAverageImageSize(imagesWithDimensions);
  const wideImages = [];
  imagesWithDimensions.forEach(({ imagePath, height, width }) => {
    if (width > height
      && width < averageDimensions.width * (1 + DOUBLE_PAGE_THRESHOLD)
      && width > averageDimensions.width * (1 - DOUBLE_PAGE_THRESHOLD)
      && height < averageDimensions.height * (1 + DOUBLE_PAGE_THRESHOLD)
      && height > averageDimensions.height * (1 - DOUBLE_PAGE_THRESHOLD)
    ) {
      wideImages.push({ imagePath, height, width });
    }
  });
  return wideImages;
}

async function splitImage(image) {
  // TODO assumes right to left, make it dynamic
  const leftWidthMax = 0.5 * image.width;
  const { dir, fileName, ext } = getPathData(image.imagePath);
  const leftOutput = `${dir}/${fileName}-b${ext}`;
  const rightOutput = `${dir}/${fileName}-a${ext}`;
  return Promise.all(
    [
      new Promise((resolve, reject) => gm(image.imagePath)
        .crop(leftWidthMax, image.height, 0, 0)
        .write(leftOutput, (err) => {
        // log.debug(`Validating Image: ${tmp}`); TODO enable as log.silly
          if (!err) {
            resolve();
          } else {
            log.debug(`Image Trimming resulted in '${err}'`);
            reject(err);
          }
        })),
      new Promise((resolve, reject) => gm(image.imagePath)
        .crop(image.width, image.height, leftWidthMax, 0)
        .write(rightOutput, (err) => {
          // log.debug(`Validating Image: ${tmp}`); TODO enable as log.silly
          if (!err) {
            resolve();
          } else {
            log.debug(`Image Trimming resulted in '${err}'`);
            reject(err);
          }
        })),
    ],
  );
}

async function splitImages(extractedArchiveDir) {
  log.info(`Splitting images in "${extractedArchiveDir}"`);
  const wideImages = await getWideImages(extractedArchiveDir);
  return Promise.all(
    wideImages.map(
      async (image) => LIMIT(async () => {
        await splitImage(image);
        await rm(image.imagePath, false);
      }),
    ),
  );
}

async function createBlankImage(archivePath) {
  const imagePath = archivePath.replace(/\.\w+$/, '.png');
  return new Promise((resolve, reject) => gm(5, 5, 'black')
    .setFormat('png')
    .write(imagePath, (err) => {
      if (!err) {
        resolve();
      } else {
        log.error(`Image creation resulted in '${err}'`);
        reject(err);
      }
    }));
}

async function createBlurredImage(imagePath) {
  const blurRadius = 200;
  return new Promise((resolve, reject) => gm(imagePath)
    .blur(blurRadius, blurRadius)
    .noise('Poisson')
    .noise('Gaussian')
    .noise('Multiplicative')
    .noise('Impulse')
    .noise('Laplacian')
    .blur(blurRadius / 10, blurRadius / 10)
    .setFormat('png')
    .write(imagePath, (err) => {
      if (!err) {
        resolve();
      } else {
        log.error(`Image creation resulted in '${err}'`);
        reject(err);
      }
    }));
}

async function censorCovers(filePath) {
  // log.info(`Blurring images in "${extractedArchiveDir}"`);
  // const wideImages = await getWideImages(extractedArchiveDir);
  return LIMIT(async () => {
    // await createBlankImage(archivePath);
    await createBlurredImage(filePath);
    // await rm(image.imagePath, false);
    log.info(`Censoring cover done for "${filePath}"`);
  });
}

module.exports = {
  trimImagesWhiteSpace,
  upscaleImages,
  splitImages,
  validateImageDir,
  validateImage,
  getImages,
  verifyImageCount,
  censorCovers,
  SUPPORTED_FORMATS,
};
