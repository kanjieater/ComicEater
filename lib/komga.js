const axios = require('axios');
const { getResults } = require('./saga');
const log = require('./logger');
const { getCleanPath } = require('./utils');
const logger = require('./logger');

const TIMEOUT_DURATION = 2000;
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

module.exports = {
  scanLibraries,
};
