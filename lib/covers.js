const google = require('googlethis');
const axios = require('axios');
const path = require('path');
const pLimit = require('p-limit');
const { getResults } = require('./saga');
const log = require('./logger');
const { getPathData, sleep } = require('./utils');
const { getComicInfoFormattedMetaData } = require('./format');
const { getWriter } = require('./files');
const { getImages } = require('./image');

const DOWNLOAD_COVERS = 'Download archive covers';
const AMAZONJP_SITE = 'amazon.co.jp';

const LIMIT = pLimit(10);
const SYNC = pLimit(1);
async function rateLimit(fn, fileName) {
  return SYNC(async () => {
    log.info(`Calling Google for ${fileName} - rate limit is 1.5 seconds per call`);
    await sleep(1500);
    return LIMIT(fn);
  });
}

function getQuery(title) {
  return `site:${AMAZONJP_SITE} ${title}`.trim();
}

async function getGoogleResults(cleanedArchivePath, title) {
  const { fileName } = getPathData(cleanedArchivePath);
  const query = getQuery(title);
  const images = await rateLimit(
    async () => google.image(query, { safe: false }),
    fileName,
  );
  return images;
}

async function checkIfCoverExists(dir, newImageName) {
  const existingImages = await getImages(dir);
  return existingImages.some((existingImage) => {
    const { fileName } = getPathData(existingImage);
    return fileName === newImageName;
  });
}

async function downloadImage(archivePath, images = []) {
  if (!images?.length && images.length === 0) {
    throw new Error(`No image available to download for for "${archivePath}"`);
  }

  const { url } = images[0];
  const { ext } = getPathData(url);
  const { dir, fileName } = getPathData(archivePath);
  const imagePath = path.resolve(dir, `${fileName}${ext}`);

  const writer = getWriter(imagePath);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function getCover(context) {
  const updatedContext = {
    ...context,
    recordChange: true,
    action: DOWNLOAD_COVERS,
  };
  const { dir, fileName } = getPathData(updatedContext.archivePath);
  const imageExists = await checkIfCoverExists(dir, fileName);
  if (imageExists) {
    log.info(`Cover image already exists for "${updatedContext.archivePath}`);
    return updatedContext;
  }
  const { title } = getComicInfoFormattedMetaData(context.contentMetaData, context);
  const images = await getGoogleResults(context.cleanedArchivePath, title);
  await downloadImage(context.archivePath, images);
  return updatedContext;
}

async function getCovers(contexts) {
  const results = await getResults(DOWNLOAD_COVERS, contexts, getCover);
  return results;
}

module.exports = {
  getCovers,
};
