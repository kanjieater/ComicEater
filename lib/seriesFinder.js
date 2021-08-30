const replaceAll = require('string.prototype.replaceall');
const log = require('./logger');
const { getPathData, escapeRegex, replaceAllInsensitive } = require('./utils');

const TEMPLATE_REGEX = /{{(.+?)}}/g;

function sanitizeAuthors(authors, key, { splitAuthorsBy }) {
  // const allDelims = escapeRegex(splitAuthorsBy.join(''));
  // const splitRegx = new RegExp(`(?:[${allDelims}])+`);
  // return authors.split(splitRegx);
  return authors;
}

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
    [key]: replaceAll(text.trim(), '_', ' ').trim(),
  };
}

function sanitizeNumbers(text, key) {
  const numRegex = /\d+/g;
  const num = Number(numRegex.exec(text)[0]);
  return {
    [key]: num,
  };
}

const sanitizers = {
  issueNumber: sanitizeNumbers,
  volumeNumber: sanitizeVolumes,
  totalVolumes: sanitizeNumbers,
  seriesName: sanitizeText,
  authors: sanitizeAuthors,
  publishYear: sanitizeNumbers,
};

function removeJunk(input, junkToFilter) {
  let cleanedInput = input;
  junkToFilter.forEach((textToRemove) => {
    if (textToRemove === '_') {
      cleanedInput = replaceAll(cleanedInput, textToRemove, ' ');
    } else {
      cleanedInput = replaceAllInsensitive(cleanedInput, textToRemove, '');
    }
  });
  const { fileName, dir, ext } = getPathData(cleanedInput);
  return `${dir.trim()}/${fileName.trim()}${ext}`;
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

function sanitizeMetaData(contentMetaData, context) {
  let sanitizedMetaData = {};
  Object.entries(contentMetaData).forEach(([key, value]) => {
    if (!sanitizers[key]) {
      return;
    }
    const sanitizedData = sanitizers[key](value, key, context);
    sanitizedMetaData = {
      ...sanitizedMetaData,
      ...sanitizedData,
    };
  });
  return sanitizedMetaData;
}

function escapeChars(str, charList) {
  let newStr = str;
  charList.forEach((char) => {
    newStr = replaceAll(newStr, char, `\\${char}`);
  });
  return newStr;
}

function checkIfAllKeysArePresent(groups, uniqueTemplateKeys) {
  const uniqueKeysPresent = uniqueTemplateKeys.every(
    (uniqueKey) => groups[uniqueKey] !== undefined,
  );

  return uniqueKeysPresent;
}

function getGroupMatch(archivePath, regex, uniqueTemplateKeys) {
  const groups = archivePath.match(regex)?.groups;
  if (!groups) {
    log.debug(`"${regex}" failed to group arguments from "${archivePath}"`);
    return false;
  }
  const uniqueKeysPresent = checkIfAllKeysArePresent(groups, uniqueTemplateKeys);
  if (uniqueKeysPresent) {
    log.debug(`Groups found for "${regex}" for "${archivePath}"`);
    return groups;
  }
  return false;
}

function getUniqueKeys(allMatches, patternTemplate) {
  const allKeys = allMatches.map(([, key]) => key);
  const uniqueTemplateKeys = [...new Set(allKeys)];
  if (uniqueTemplateKeys.length === 0) {
    throw new Error(`No template keys were found in ${patternTemplate}`);
  }
  return uniqueTemplateKeys;
}

function getTemplateMatches(patternTemplate) {
  const allMatches = Array.from(patternTemplate.matchAll(TEMPLATE_REGEX));
  const uniqueKeys = getUniqueKeys(allMatches, patternTemplate);
  return { allMatches, uniqueKeys };
}

function getCaptureGroupSelector(templateMatch, templateKey, regStr) {
  // Get characters that bridge between the current template and the next template
  const bridgeCharsRegex = new RegExp(`(?<offset>.*?)\\{\\{${templateKey}\\}\\}(?<bridgeChars>.*?)\\{\\{`);
  const bridgeChars = bridgeCharsRegex.exec(regStr);
  let captureStyle = '(?:[^/]?)+';
  if (bridgeChars) {
    const [, , capturedBridgeChars] = bridgeChars;
    if (capturedBridgeChars.includes(' ')) {
      captureStyle = `(?:[${capturedBridgeChars}]|[^/]?)+`;
    }
  }
  const namedGroup = `(?<${templateKey}>${captureStyle})`;
  return regStr.replace(templateMatch, namedGroup);
}

function generateCaptureGroupRegex(allMatches, patternTemplate) {
  let regStr = patternTemplate;
  allMatches.forEach(([match, key]) => {
    regStr = getCaptureGroupSelector(match, key, regStr);
  });
  return regStr;
}

function mapGlobToRegexStr(str) {
  // TODO follow spec
  let regex = replaceAll(str, '/**/*', '/(?:.*)');
  regex = replaceAll(regex, '**/*', '(?:.*)/');
  regex = replaceAll(regex, '/**/', '/(?:.*)/');
  regex = replaceAll(regex, '/*', '/(?:.*)');
  regex = replaceAll(regex, '*/', '(?:.*)/');

  return `^${regex}$`;
}

function getRegex(allMatches, patternTemplate) {
  const preEscapedPattern = escapeChars(patternTemplate, [')', '(', '[', ']', ',']);
  const captureGroupRegex = generateCaptureGroupRegex(allMatches, preEscapedPattern);
  const postEscapePattern = mapGlobToRegexStr(captureGroupRegex);
  log.debug(`Transformed "${patternTemplate}" into "${postEscapePattern}"`);
  return new RegExp(postEscapePattern);
}

function getFileMetaData(archivePath, patternTemplates, context) {
  let contentMetaData = {};
  patternTemplates.find((patternTemplate) => {
    const { allMatches, uniqueKeys } = getTemplateMatches(patternTemplate);
    const regex = getRegex(allMatches, patternTemplate);
    const proposedMetaData = getGroupMatch(archivePath, regex, uniqueKeys);
    try {
      contentMetaData = sanitizeMetaData(proposedMetaData, context);
    } catch (e) {
      log.debug(`"${patternTemplate}" matched "${archivePath}" but could not sanitize the data: ${e}`);
    }
    return Object.keys(contentMetaData).length;
  });
  return contentMetaData;
}

function getFolderMetaData(archiveDirFragment, folderPatterns, context) {
  const wildFolderPatterns = folderPatterns.map((folderPattern) => {
    const lastChar = folderPattern[folderPattern.length - 1];
    if (lastChar !== '/' && lastChar !== '*') {
      throw new Error(`Folder Pattern must end in a / or a *. This pattern does not: ${folderPattern}`);
    }
    if (folderPattern[0] === '/') {
      throw new Error(`Folder Pattern must not start with  / as it begins from the queueFolder. This pattern does: ${folderPattern}`);
    }

    return folderPattern;
  });
  return getFileMetaData(archiveDirFragment, wildFolderPatterns, context);
}

module.exports = {
  getFolderMetaData,
  getFileMetaData,
  removeJunk,
  mapGlobToRegexStr,
  getTemplateMatches,
  getRegex,
};
