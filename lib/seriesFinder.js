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

function generateRegex(allMatches, patternTemplate) {
  let regex = patternTemplate;
  allMatches.forEach(([match, key]) => {
    const namedGroup = `(?<${key}>.+)`;
    regex = regex.replace(match, namedGroup);
  });
  return new RegExp(regex);
}

function generateRegexAndKeys(patternTemplate) {
  const templateRegex = /{{(.*?)}}/g;
  const allMatches = Array.from(patternTemplate.matchAll(templateRegex));
  const allKeys = allMatches.map(([, key]) => key);
  const uniqueTemplateKeys = [...new Set(allKeys)];
  if (uniqueTemplateKeys.length === 0) {
    throw new Error(`No template keys were found in ${patternTemplate}`);
  }
  const regex = generateRegex(allMatches, patternTemplate);

  return { regex, uniqueTemplateKeys };
}

function getGroupMatch(archivePath, filePattern) {
  const { regex, uniqueTemplateKeys } = generateRegexAndKeys(filePattern);

  const { groups } = archivePath.match(regex);
  // Check if all unique keys are present
  const uniqueKeysPresent = uniqueTemplateKeys.every(
    (uniqueKey) => groups[uniqueKey] !== undefined,
  );
  if (uniqueKeysPresent) {
    return groups;
  }
  return false;
}

function sanitizeVolumes(volume) {
  const volumeRegex = /\d+/;
  const volumeRange = Number(volumeRegex.exec(volume)[0]);
  return {
    volumeNumber: volumeRange,
  };
}

function sanitizeText(text, key) {
  return {
    [key]: text.trim(),
  };
}

const sanitizers = {
  volumeNumber: sanitizeVolumes,
  seriesName: sanitizeText,
};

function sanitizeMetaData(contentMetaData) {
  let sanitizedMetaData = {};
  Object.entries(contentMetaData).forEach(([key, value]) => {
    if (!sanitizers[key]) {
      return;
    }
    const sanitizedData = sanitizers[key](value, key);
    sanitizedMetaData = {
      ...sanitizedMetaData,
      ...sanitizedData,
    };
  });
  return sanitizedMetaData;
}

function getFileMetaData(archivePath, filePatterns) {
  let contentMetaData = {};
  filePatterns.find((filePattern) => {
    contentMetaData = getGroupMatch(archivePath, filePattern);
    return Object.keys(contentMetaData).length;
  });
  return sanitizeMetaData(contentMetaData);
}

function getFolderMetaData(archivePath, folderPatterns) {
  // Remove root
}

function getFilteredPaths(archivePath) {

}

module.exports = {
  getFolderMetaData,
  getFileMetaData,
  getFilteredPaths,
  find,
  extractVolumeNumber,
};
