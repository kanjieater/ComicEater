const replaceAll = require('string.prototype.replaceall');
const log = require('./logger');
const { getPathData } = require('./utils');

function sanitizeVolumes(volume, key) {
  const volumeRegex = /\d+/g;
  const volumeRange = Number(volumeRegex.exec(volume)[0]);
  log.debug(volume);
  return {
    [key]: volumeRange,
  };
}

function sanitizeText(text, key) {
  return {
    [key]: replaceAll(replaceAll(text.trim(), '_', ' '), '-', ' ').trim(),
  };
}

const sanitizers = {
  volumeNumber: sanitizeVolumes,
  totalVolumesNumber: sanitizeVolumes,
  seriesName: sanitizeText,
  authors: sanitizeText,
  year: sanitizeVolumes,
};

function removeJunk(input, junkToFilter) {
  let cleanedInput = input;
  junkToFilter.forEach((textToRemove) => {
    cleanedInput = replaceAll(input, textToRemove, '');
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
    const namedGroup = `(?<${key}>.+?)`;
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

function escapeChars(str, charList) {
  let newStr = str;
  charList.forEach((char) => {
    newStr = replaceAll(newStr, char, `\\${char}`);
  });
  return newStr;
}

function mapGlobToRegexStr(str) {
  // TODO follow spec
  let regex = escapeChars(str, [')', '(']);

  regex = replaceAll(regex, '/**/*', '(/)(?:.*)');
  regex = replaceAll(regex, '/**/', '(/)(?:.*)(/)');
  regex = replaceAll(regex, '/*', '(/)(?:.*)');
  regex = replaceAll(regex, '*/', '(?:.*?)(/)');

  regex = escapeChars(regex, ['[', ']', '/', ',']);

  return `^${regex}$`;
}

function getFolderMetaData(archiveDirFragment, folderPatterns) {
  const wildFolderPatterns = folderPatterns.map((folderPattern) => {
    const lastChar = folderPattern[folderPattern.length - 1];
    if (lastChar !== '/' && lastChar !== '*') {
      throw new Error(`Folder Pattern must end in a / or a *. This pattern does not: ${folderPattern}`);
    }
    if (folderPattern[0] === '/') {
      throw new Error(`Folder Pattern must not start with  / as it begins from the queueFolder. This pattern does: ${folderPattern}`);
    }

    return mapGlobToRegexStr(folderPattern);
  });
  return getFileMetaData(archiveDirFragment, wildFolderPatterns);
}

module.exports = {
  getFolderMetaData,
  getFileMetaData,
  removeJunk,
  mapGlobToRegexStr,
  find,
  extractVolumeNumber,
};
