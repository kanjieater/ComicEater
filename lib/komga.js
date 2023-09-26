const axios = require('axios');
const path = require('path');
const { getResults } = require('./saga');
const log = require('./logger');
const { getCleanPath } = require('./utils');
const logger = require('./logger');
const { getContextsWithoutCovers } = require('./covers');
const { getArchives } = require('./command');
const { censorCovers } = require('./image');

const TIMEOUT_DURATION = 2000;
const GET_TAG = 'Get Tagged Series';
const CENSOR_IMAGES = 'Censor tagged Covers';
const GET_LIBRARIES = 'Get Komga Libraries';
const SCAN_LIBRARIES = 'Scan Komga Libraries';

async function scanLibrary(context) {
  const updatedContext = {
    ...context,
    recordChange: false,
    action: SCAN_LIBRARIES,
  };
  const { baseUrl, username, password } = updatedContext.defaults.komga;
  const { name, id } = updatedContext.library;
  log.info(`Triggering scan for ${name}`);

  const url = `${baseUrl}/api/v1/libraries/${id}/scan`;
  await axios.post(url, null, {
    timeout: TIMEOUT_DURATION,
    auth: {
      username,
      password,
    },
  });
  logger.info(`Scan request successful ${name}`);
  return updatedContext;
}

async function getKomgaLibraries({ baseUrl, username, password }) {
  let libraries = {};
  try {
    const response = await axios.get(`${baseUrl}/api/v1/libraries`, {
      timeout: TIMEOUT_DURATION,
      auth: {
        username,
        password,
      },
    });
    libraries = response.data;
  } catch (error) {
    log.error('Error retrieving Komga libraries:', error);
  }
  return libraries;
}

async function getLibraries(context) {
  const updatedContext = {
    ...context,
    recordChange: false,
    action: GET_LIBRARIES,
  };
  const komgaLibraries = await getKomgaLibraries(updatedContext.defaults.komga);

  updatedContext.libraries = komgaLibraries.map((library) => ({
    ...library,
    normalizedRoot: getCleanPath(library.root),
  }));
  return updatedContext;
}

async function scanLibraries(contexts, config) {
  const librariesResults = await getResults(GET_LIBRARIES, [config], getLibraries);
  if (librariesResults.unsuccessful.length) {
    return librariesResults;
  }

  const [{ libraries }] = librariesResults.successful;
  const matchingLibraries = contexts.reduce((matching, context) => {
    const library = libraries.find(
      (lib) => context.seriesRoot.includes(lib.normalizedRoot),
    );
    if (library) {
      matching.push({ ...config, library });
    }
    return matching;
  }, []);
  const results = await getResults(SCAN_LIBRARIES, matchingLibraries, scanLibrary);
  return results;
}

async function getByTag({
  baseUrl, username, password,
}, tag) {
  const content = {};
  try {
    const response = await axios.get(`${baseUrl}/api/v1/series`, {
      timeout: TIMEOUT_DURATION,
      auth: {
        username,
        password,
      },
      params: {
        search: `tag:${tag}`,
        size: 1000,
      },
    });
    content.series = response.data.content;
    const bookResponse = await axios.get(`${baseUrl}/api/v1/books`, {
      timeout: TIMEOUT_DURATION,
      auth: {
        username,
        password,
      },
      params: {
        search: `tag:${tag}`,
        size: 1000,
      },
    });
    content.books = bookResponse.data.content;
  } catch (error) {
    log.error('Error retrieving Komga Tagged Content:', error);
  }
  return content;
}

async function getTaggedSeries(context) {
  const updatedContext = {
    ...context,
    recordChange: false,
    action: GET_TAG,
  };
  const censorTag = updatedContext.defaults.komga.censorTag[0];
  const taggedContent = await getByTag(
    updatedContext.defaults.komga, censorTag,
  );
  const filteredTaggedSeries = taggedContent.series.filter(
    (series) => series.metadata.tags.includes(censorTag),
  );
  const combinedBooksAndSeries = filteredTaggedSeries.concat(taggedContent.books);
  updatedContext.content = combinedBooksAndSeries.map((content) => ({
    ...content,
    normalizedRoot: getCleanPath(content.url),
  }));

  return updatedContext;
}

async function censorKomgaCovers(context) {
  const updatedContext = {
    ...context,
    recordChange: false,
    action: CENSOR_IMAGES,
  };
  await censorCovers(updatedContext);
  return updatedContext;
}

async function handleTaggedCovers(config, context) {
  const taggedResults = await getResults(GET_TAG, [config], getTaggedSeries);
  if (taggedResults.unsuccessful.length) {
    return taggedResults;
  }
  // const archiveResults = await getResults(GET_TAG, [config], getArchives);
  const arrays = await Promise.all(
    taggedResults.successful[0].content.map(
      async ({ normalizedRoot }) => {
        const hasFileExtension = path.extname(normalizedRoot) !== '';

        if (hasFileExtension) {
          return [{ archivePath: normalizedRoot }];
        }
        const archives = await getArchives(normalizedRoot);
        return archives;
      },
    ),
  );
  const allArchives = Array.prototype.concat(...arrays);

  const validContexts = await getContextsWithoutCovers(allArchives);
  const censorCoversResults = await getResults(CENSOR_IMAGES, validContexts, censorKomgaCovers);
  // const results = await getResults(SCAN_LIBRARIES, matchingLibraries, scanLibrary);
  return censorCoversResults;
}

module.exports = {
  handleTaggedCovers,
  scanLibraries,
};
