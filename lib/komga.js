const axios = require('axios');
const { getResults } = require('./saga');
const log = require('./logger');
const { inspect, getCleanPath } = require('./utils');
const logger = require('./logger');

const TIMEOUT_DURATION = 2000;
const SCAN_LIBRARIES = 'Scan Komga Libraries';

async function scanLibrary(context) {
  const { library } = context;
  log.info(`Triggering scan for ${library?.name}`);
  return context;
}

async function getKomgaLibraries({ baseUrl, httpUsername, httpPassword }) {
  let libraries = {};
  const headers = {
    Authorization: `Basic ${Buffer.from(`${httpUsername}:${httpPassword}`).toString('base64')}`,
  };
  try {
    const response = await axios.get(`${baseUrl}/api/v1/libraries`, {
      timeout: TIMEOUT_DURATION,
      headers,
    });
    libraries = response.data;
  } catch (error) {
    log.error('Error retrieving Komga libraries:', error);
  }
  return libraries;
}

async function getLibraries(config) {
 
  let komgaLibraries;
  try {
    komgaLibraries = await getKomgaLibraries(config.defaults.komga);
    log.debug('Komga libraries:', komgaLibraries);
  } catch (error) {
    log.error('Error retrieving Komga libraries:', error);
    throw error;
  }
  const normalizedKomgaLibraryPaths = komgaLibraries.map((library) => ({
    ...library,
    normalizedRoot: getCleanPath(library.root),
  }));
  return normalizedKomgaLibraryPaths;
}

async function scanLibraries(contexts, config) {
  // const contextsWithoutCovers = await Promise.all(
  //   contexts.map(async (context) => needsCover(context)),
  // );
  log.debug(inspect(contexts));
  const libraries = await getLibraries(config);
  const matchingLibraries = contexts.map((context) => ({
    ...context,
    library: libraries.find(
      (library) => context.seriesRoot.includes(library.normalizedRoot),
    ),
  }));
  const results = await getResults(SCAN_LIBRARIES, matchingLibraries, scanLibrary);
  return results;
}

module.exports = {
  scanLibraries,
};
