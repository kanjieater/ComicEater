const log = require('./logger');

function removeVol() {

}

function getVol() {

}

function removeJunk(input, junkToFilter) {
  let cleanedInput = input;
  junkToFilter.forEach((regex) => {
    cleanedInput = input.replace(new RegExp(regex, 'g'), '');
  });
  return cleanedInput.trim();
}

function extractVolumeNumber(input, volumeNumberFilters) {
  let cleanedInput = input;
  let hasVolumeNumber = false;
  let volumeNumber = null;
  let removedVolumeInput = cleanedInput;
  let isDone = false;
  volumeNumberFilters.forEach((regex) => {
    if (isDone) {
      return;
    }
    const r = new RegExp(regex, 'g');
    cleanedInput = cleanedInput.replace(r, '').trim();

    const matches = input.matchAll(r);
    for (const match of matches) {
      if (match.length === 2) {
        log.debug(`${removedVolumeInput} before`);
        const indexOfMatch = removedVolumeInput.indexOf(match[0]);
        removedVolumeInput = removedVolumeInput.slice(0, indexOfMatch).trim();
        log.debug(removedVolumeInput);
        volumeNumber = Number(match[1]);
        log.debug(`Found volume number ${volumeNumber}`);
        hasVolumeNumber = true;
        isDone = true;
        break;
      }
    }
  });
  return { volumeNumber, updatedInput: removedVolumeInput, hasVolumeNumber };
}

function find(input, config) {
  const cleanedInput = removeJunk(input, config.junkToFilter);
  const {
    volumeNumber,
    updatedInput,
    hasVolumeNumber,
  } = extractVolumeNumber(cleanedInput, config.volumeNumberFilters);

  return { seriesName: updatedInput, volumeNumber, hasVolumeNumber };
}

module.exports = {
  find,
  extractVolumeNumber,
};
