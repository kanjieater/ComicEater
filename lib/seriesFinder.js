const path = require('path');
const replaceAll = require('string.prototype.replaceall');
const clone = require('just-clone');
const log = require('./logger');
const { getPathData, escapeRegex, replaceAllInsensitive } = require('./utils');

const TEMPLATE_REGEX = /{{(.+?)}}/g;

function sanitizeAuthors(authors, key, config) {
  const splitAuthorsBy = config?.splitAuthorsBy || [''];
  const allDelims = escapeRegex(splitAuthorsBy.join(''));
  let cleanAuthors = [authors];

  if (allDelims) {
    const splitRegx = new RegExp(`[${allDelims}]`, 'ig');
    cleanAuthors = authors.split(splitRegx);
  }

  return {
    writer: cleanAuthors,
    authors: cleanAuthors,
  };
}

function sanitizeVolumes(volume) {
  const matchNumbersAndAtMostVariantChar = /\d+(?:\w(?!\w)){0,1}/ig;
  const matches = volume.match(matchNumbersAndAtMostVariantChar);
  const volumeRange = [];
  matches.forEach((match) => {
    const lastChar = match.slice(-1);
    const volEntry = {};
    if (Number.isNaN(parseInt(lastChar, 10))) {
      volEntry.volumeVariant = lastChar;
      volEntry.volumeNumber = Number(match.slice(0, match.length - 1));
    } else {
      volEntry.volumeNumber = Number(match);
    }
    volumeRange.push(volEntry);
  });
  const parsedVolume = clone(volumeRange.sort((a, b) => a.volumeNumber - b.volumeNumber)[0]);
  if (volumeRange.length > 1) {
    parsedVolume.volumeRange = volumeRange;
  }
  return parsedVolume;
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

function convertFromHalfFullWidth(input) {
  // https://stackoverflow.com/questions/20486551/javascript-function-to-convert-utf8-string-between-fullwidth-and-halfwidth-forms
  return input.replace(
    /[\uff01-\uff5e]/g,
    (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

function convertSpaces(input) {
  // accounts for wide space: \u3000
  return input.replace(
    /[\s]/g,
    () => ' ',
  );
}

function cleanFilePath(input) {
  let cleanOutput = input.replace(/(?<![/])_/g, ' ');
  cleanOutput = input.replace(/[/]_/g, '/0 0 ');
  if (input.charAt(0) === '_') {
    // Sometimes _ is used to put a file at the top for the cover 😣
    // So we still want it at the top, but CBZDisplay ignores _ sorting
    // Slap a few zeros on the front to get around it
    cleanOutput = `0 0 ${cleanOutput}`;
  }
  return cleanOutput;
}

function removeJunk(input, junkToFilter) {
  const ifEmpty = 'empty';
  let cleanedInput = input;
  if (junkToFilter.includes('_')) {
    cleanedInput = cleanFilePath(cleanedInput);
  }
  junkToFilter.filter((junk) => junk !== '_').forEach((textToRemove) => {
    cleanedInput = replaceAllInsensitive(cleanedInput, textToRemove, '');
  });
  const normalizedSpaces = convertSpaces(cleanedInput);
  const normalizedInput = convertFromHalfFullWidth(normalizedSpaces);
  const { fileName, dir, ext } = getPathData(normalizedInput);
  const d = dir.trim() || ifEmpty;
  let f = fileName.trim() || ifEmpty;

  if (f.charAt(0) === '.') {
    log.debug('Unhiding files');
    f = f.slice(1);
  }
  const cleanD = d.split(path.sep).map((subD) => subD.trim()).join(path.sep);
  return `${cleanD}/${f}${ext}`;
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
