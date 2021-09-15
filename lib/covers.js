const axios = require('axios');
const path = require('path');
const pLimit = require('p-limit');
const Scraper = require('images-scraper');
const { getResults } = require('./saga');
const log = require('./logger');
const { getPathData, sleep } = require('./utils');
const { getComicInfoFormattedMetaData } = require('./format');
const { getWriter } = require('./files');
const { getImages } = require('./image');
const { convertFromHalfFullWidth } = require('./format');

const DOWNLOAD_COVERS = 'Download Archive Covers';
const AMAZONJP_SITE = 'amazon.co.jp';
const BOOKMETER = 'bookmeter.com';
const BOOKMETER_SELECTOR = '.group__image img';

const LIMIT = pLimit(10);
const SYNC = pLimit(1);

const google = new Scraper({
  puppeteer: {
    headless: true,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-first-run',
      '--no-sandbox',
      '--no-zygote',
      '--single-process',
    ],
  },
});

async function rateLimit(fn, fileName) {
  return SYNC(async () =>
    // log.info(`Calling Google for ${fileName} - rate limit is 1.5 seconds per call`);
    // await sleep(1500);
    LIMIT(fn));
}

function getQuery(coverQuery, title, seriesName, volumeNumber, authors = []) {
  let subquery = title;
  if (volumeNumber !== undefined) {
    subquery = ` ${volumeNumber}`;
  }
  const targeting = coverQuery || `${seriesName || ''} site:${BOOKMETER} ${authors.join(' ')}`;
  return `${subquery} ${targeting}`.trim();
}

function containsExactVol(title, seriesName, volumeNumber) {
  if (volumeNumber === undefined) {
    return true;
  }
  const regex = new RegExp(`(?<![.|-]|[0-9])${volumeNumber}(?![.|-]|[0-9])`);
  return regex.test(title.replace(seriesName, ''));
}

function filterSearchResults(result, seriesName, volumeNumber) {
  const cleanSeriesName = convertFromHalfFullWidth(seriesName);
  const cleanTitle = convertFromHalfFullWidth(result?.title || '');

  return cleanTitle?.includes(cleanSeriesName)
    && containsExactVol(cleanTitle, cleanSeriesName, volumeNumber);
}

async function getGoogleResults(
  cleanedArchivePath, title, { seriesName, volumeNumber, authors }, coverQuery, noCoverValidate,
) {
  const { fileName } = getPathData(cleanedArchivePath);

  const query = getQuery(coverQuery, title, seriesName, volumeNumber, authors);

  const results = await rateLimit(
    async () => google.scrape(query, 5),
    fileName,
  );
  log.debug(`Found ${results.length} when looking for "${fileName}"`);

  const filtered = results.filter(
    (result) => {
      if (noCoverValidate) {
        return true;
      }
      return filterSearchResults(result, seriesName, volumeNumber);
    },
  );
  return filtered[0] && filtered[0]?.url;
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

  const url = images[0];
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

async function needsCover(context) {
  const { archivePath } = context;
  const { dir, fileName } = getPathData(archivePath);
  const imageExists = await checkIfCoverExists(dir, fileName);
  if (imageExists) {
    log.info(`Cover image already exists for "${archivePath}`);
    return {};
  }
  return { ...context };
}

async function getCover(context) {
  const updatedContext = {
    ...context,
    recordChange: false,
    action: DOWNLOAD_COVERS,
  };
  const { title } = getComicInfoFormattedMetaData(context.contentMetaData, context);
  const url = await getGoogleResults(
    context.cleanedArchivePath,
    title,
    context.contentMetaData,
    context.coverQuery,
    context.noCoverValidate,
  );
  if (!url) {
    log.info(`Could not google an image for "${updatedContext.archivePath}`);
    return updatedContext;
  }
  // const images = [await scrapeGoogleImages(url)];
  await downloadImage(context.archivePath, [url]);
  return updatedContext;
}

async function getCovers(contexts) {
  const contextsWithoutCovers = await Promise.all(
    contexts.map(async (context) => needsCover(context)),
  );
  const validContexts = contextsWithoutCovers.filter((context) => context.archivePath);
  const results = await getResults(DOWNLOAD_COVERS, validContexts, getCover);
  return results;
}

module.exports = {
  getCovers,
};
