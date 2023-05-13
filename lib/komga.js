const axios = require('axios');
const { getResults } = require('./saga');
const log = require('./logger');
const { getCleanPath } = require('./utils');
const logger = require('./logger');

const TIMEOUT_DURATION = 2000;
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

async function getLibraries(config) {
  const komgaLibraries = await getKomgaLibraries(config.defaults.komga);

  const normalizedKomgaLibraryPaths = komgaLibraries.map((library) => ({
    ...library,
    normalizedRoot: getCleanPath(library.root),
  }));
  return normalizedKomgaLibraryPaths;
}

async function scanLibraries(contexts, config) {
  let libraries;
  try {
    libraries = await getLibraries(config);
  } catch (error) {
    return [];
  }
  // const matchingLibraries = contexts.map((context) => ({
  //   library: libraries.find(
  //     (library) => context.seriesRoot.includes(library.normalizedRoot),
  //   ),
  // }));
  // const matchingLibraries = contexts.filter((context) => libraries.some(
  //   (library) => context.seriesRoot.includes(library.normalizedRoot),
  // ));
  // matchingLibraries.forEach(element => {
  //   scanLibrary
  // });
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
