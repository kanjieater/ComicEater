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

function getQuery(title, seriesName, volumeNumber, authors = []) {
  let subquery = title;
  if (seriesName && volumeNumber !== undefined) {
    subquery = `${seriesName} ${volumeNumber}`;
  }
  return `site:${BOOKMETER} ${subquery} ${authors.join(' ')}`.trim();
}

function containsExactVol(title, seriesName, volumeNumber) {
  if (volumeNumber === undefined) {
    return true;
  }
  const regex = new RegExp(`(?<![\.]|[0-9])${volumeNumber}(?![.]|[0-9])`);
  return regex.test(title.replace(seriesName, ''));
}

// async function fetchHTML(url) {
//   const { data } = await axios.get('https://bookmeter.com/books/529341', {
//     headers: {
//       'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36',
//       Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
//       'Accept-Encoding': 'gzip',
//       'Accept-Language': 'en-US,en;q=0.9',
//       'Cache-Control': 'max-age=0',
//       Connection: 'keep-alive',
//       Cookie: '_session_id_elk=7945a34aa7f605ab17366f0e8bc30ae3',
//       Host: 'bookmeter.com',
//       'If-None-Match': 'W/"2a584cfc3dffc6a6bfbbd4558f5e2342"',
//       'Sec-Fetch-Dest': 'document',
//       'Sec-Fetch-Mode': 'navigate',
//       'Sec-Fetch-Site': 'none',
//       'Sec-Fetch-User': '?1',
//       'Upgrade-Insecure-Requests': 1,
//     },
//   });
//   return cheerio.load(data);
// }

// async function scrapeBookMeter(url) {
//   const $ = await fetchHTML(url);
//   const imgUrl = $(BOOKMETER_SELECTOR)?.attr('src');
//   return imgUrl;
// }

// This occasionally gets bad results from google directly
// const images = await rateLimit(
//   async () => google.image(query, { safe: false }),
//   fileName,
// );
async function getGoogleResults(cleanedArchivePath, title, { seriesName, volumeNumber, authors }) {
  const { fileName } = getPathData(cleanedArchivePath);
  const query = getQuery(title, seriesName, volumeNumber, authors);
  // );

  const results = await rateLimit(
    async () => google.scrape(query, 5),
    fileName,
  );
  log.debug(`Found ${results.length} when looking for "${fileName}"`);

  const filtered = results.filter((result) => {
    const webTitle = result?.title;
    return webTitle?.includes(seriesName) && containsExactVol(webTitle, seriesName, volumeNumber);
  });
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

async function getCover(context) {
  const updatedContext = {
    ...context,
    recordChange: false,
    action: DOWNLOAD_COVERS,
  };
  const { dir, fileName } = getPathData(updatedContext.archivePath);
  const imageExists = await checkIfCoverExists(dir, fileName);
  if (imageExists) {
    log.info(`Cover image already exists for "${updatedContext.archivePath}`);
    return updatedContext;
  }
  const { title } = getComicInfoFormattedMetaData(context.contentMetaData, context);
  const url = await getGoogleResults(context.cleanedArchivePath, title, context.contentMetaData);
  if (!url) {
    log.info(`Could not google an image for "${updatedContext.archivePath}`);
    return updatedContext;
  }
  // const images = [await scrapeGoogleImages(url)];
  await downloadImage(context.archivePath, [url]);
  return updatedContext;
}

async function getCovers(contexts) {
  const results = await getResults(DOWNLOAD_COVERS, contexts, getCover);
  return results;
}

module.exports = {
  getCovers,
};
