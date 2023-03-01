const clone = require('just-clone');
const path = require('path');
const log = require('./logger');
const { zeroPad, getPathData, replaceAllInsensitive } = require('./utils');

function joinBy(input, delim = ', ') {
  const arr = Array.isArray(input) ? input : [input];
  return arr.map((s) => s.trim()).join(delim);
}

function fileFormatVolumes(value, key, { volumeNumberZeroPadding }) {
  return zeroPad(value, volumeNumberZeroPadding);
}

function fileFormatIssues(value, key, { issueNumberZeroPadding }) {
  return zeroPad(value, issueNumberZeroPadding);
}

function fileFormatSubChapter(value) {
  return Number(value);
}

function removeHtml(value) {
  // Remove HTML https://stackoverflow.com/a/822464
  if (!value) {
    return value;
  }
  return value.replace(/<[^>]*>?/gm, '');
}

function titleFormatter(outputPath) {
  const { fileName } = getPathData(outputPath);
  return fileName;
}

function fileFormatAuthors(authors, key, { joinAuthorsBy }) {
  return joinBy(authors, joinAuthorsBy);
}
function comicInfoFormatAuthors(contentMetaData) {
  const {
    inker, penciller, coverArtist, letterer, writer,
  } = contentMetaData;

  const authors = {
    inker, penciller, coverArtist, letterer, writer,
  };
  const hasOtherAuthors = Object.keys(authors).some((author) => !!author);
  const formattedAuthors = {};
  if (contentMetaData.authors && !hasOtherAuthors) {
    authors.writer = joinBy(contentMetaData.authors);
  } else {
    Object.entries(authors).forEach(([key, value]) => {
      if (value) {
        formattedAuthors[key] = joinBy(value);
      } else {
        delete formattedAuthors[key];
      }
    });
  }

  return formattedAuthors;
}

function comicInfoFormatNumber(volumeNumber, subChapter) {
  let formattedVolume = { };
  if (volumeNumber) {
    formattedVolume = { volumeNumber };
  }
  if (subChapter) {
    formattedVolume = { volumeNumber: `${volumeNumber || 0}.${subChapter}` };
  }
  return formattedVolume;
}

function formatVolumeRange(volumeRange) {
  return volumeRange.map(({ volumeNumber, volumeVariant }) => `${volumeNumber}${volumeVariant || ''}`).join('-');
}

function fileFormatVolumeRange(volumeRange, key, config) {
  return formatVolumeRange(volumeRange.map((volEntry) => ({
    ...volEntry,
    volumeNumber: fileFormatVolumes(volEntry.volumeNumber, key, config),
  })));
}

function genresFormatter(genres) {
  return joinBy(genres);
}

function ageRatingFormatter() {

}

function formatNumbers(input) {
  return input;
}

function comicInfoFormatStatus(status) {
  // Valid Statuses: ongoing, ended, hiatus, abandoned

}

function noop(input) {
  return input;
}

const comicInfoFormatters = {
  issueNumber: formatNumbers,
  volumeNumber: formatNumbers,
  seriesName: noop,
  languageISO: noop,
  description: removeHtml,
  manga: noop,
  ageRating: ageRatingFormatter,
  genres: genresFormatter,
  volumeRange: formatVolumeRange,
  // status: comicInfoFormatStatus,
};

const fileFormatters = {
  issueNumber: fileFormatIssues,
  subChapter: fileFormatSubChapter,
  volumeNumber: fileFormatVolumes,
  authors: fileFormatAuthors,
  volumeRange: fileFormatVolumeRange,
};

function applyTemplate(template, data) {
  let output = template;
  const templateRegex = /{{(.*?)}}/g;
  const allMatches = Array.from(template.matchAll(templateRegex));
  const allKeys = allMatches.map(([, key]) => key);
  const uniqueTemplateKeys = [...new Set(allKeys)];
  const matched = uniqueTemplateKeys.every((key) => {
    const variableRegex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    const hasKey = Object.prototype.hasOwnProperty.call(data, key);
    if (variableRegex.test(output) && hasKey) {
      output = output.replace(variableRegex, data[key]);
      return true;
    }
    return false;
  });

  return matched ? output : false;
}

function getOutputFilePath(
  outputNamingConventions,
  combinedMetaData,
  seriesRoot,
  cleanedArchivePath,
  enhancements,
) {
  let outputFilePath = false;
  const { fileName, ext } = getPathData(cleanedArchivePath);
  outputNamingConventions.find((outputNamingConvention) => {
    outputFilePath = applyTemplate(
      outputNamingConvention,
      {
        ...combinedMetaData,
        seriesRoot,
        fileName,
      },
    );
    return outputFilePath;
  });
  if (!outputFilePath) {
    throw new Error(`A matching output naming convention wasn't found for: "${cleanedArchivePath}"`);
  }
  let enhancementsString = Object.entries(enhancements || {}).map(([key, value]) => (value ? key : '')).join('-');
  enhancementsString = enhancementsString ? `-${enhancementsString}` : enhancementsString;
  return `${outputFilePath}${enhancementsString}${ext}`;
}

function getComicInfoFormattedMetaData(contentMetaData, context) {
  const formatted = {};
  Object.entries(contentMetaData).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(comicInfoFormatters, key)) {
      const formattedData = comicInfoFormatters[key](value, key, context);
      if (formattedData !== undefined && formattedData !== null && formattedData !== '') {
        formatted[key] = formattedData;
      }
    }
  });
  const {
    cleanedArchivePath,
    titleNamingConventions,
    seriesRoot,
  } = context;
  const titlePath = getOutputFilePath(
    titleNamingConventions,
    { ...clone(contentMetaData), ...clone(formatted) },
    seriesRoot,
    cleanedArchivePath,
    context.enhancements,
  );
  formatted.title = titleFormatter(titlePath);

  const formattedAuthors = comicInfoFormatAuthors(contentMetaData, context);
  const sortNumber = comicInfoFormatNumber(
    contentMetaData.volumeNumber,
    contentMetaData.subChapter,
  );
  return { ...formatted, ...formattedAuthors, ...sortNumber };
}

function getFileFormattedMetaData(contentMetaData, context) {
  const formatted = {};
  Object.entries(contentMetaData).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(fileFormatters, key)) {
      formatted[key] = fileFormatters[key](value, key, context);
    }
  });
  const {
    outputNamingConventions,
    seriesRoot,
    cleanedArchivePath,
  } = context;
  formatted.outputFilePath = getOutputFilePath(
    outputNamingConventions,
    { ...clone(contentMetaData), ...clone(formatted) },
    seriesRoot,
    cleanedArchivePath,
    context.enhancements,
  );
  // const formattedAuthors = fileFormatAuthors(contentMetaData, context);
  return { ...formatted };
}

function convertFromHalfFullWidth(input) {
  // https://stackoverflow.com/questions/20486551/javascript-function-to-convert-utf8-string-between-fullwidth-and-halfwidth-forms
  const normalizedString = input.normalize('NFKC');
  const normalized = normalizedString.replace(
    /[\uff01-\uff5e]/g,
    (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  return normalized;
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
  cleanOutput = cleanOutput.replace(/[/]_/g, '/00000');
  if (input.charAt(0) === '_') {
    // Sometimes _ is used to put a file at the top for the cover 😣
    // So we still want it at the top, but CBZDisplay ignores _ sorting
    // Slap a few zeros on the front to get around it
    cleanOutput = `00000${cleanOutput}`;
  }
  return cleanOutput;
}

function cleanFileName(normalizedInput) {
  const ifEmpty = 'empty';
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

function removeJunk(input, junkToFilter) {
  let cleanedInput = input;
  if (junkToFilter.includes('_')) {
    cleanedInput = cleanFilePath(cleanedInput);
  }
  if (cleanedInput.includes('／')) {
    cleanedInput = replaceAllInsensitive(cleanedInput, '／', '・');
  }
  junkToFilter.filter((junk) => junk !== '_').forEach((textToRemove) => {
    cleanedInput = replaceAllInsensitive(cleanedInput, textToRemove, '');
  });
  const normalizedSpaces = convertSpaces(cleanedInput);
  const normalizedInput = convertFromHalfFullWidth(normalizedSpaces);
  return cleanFileName(normalizedInput);
}

module.exports = {
  convertFromHalfFullWidth,
  removeJunk,
  getFileFormattedMetaData,
  getComicInfoFormattedMetaData,
  getOutputFilePath,
};
