const clone = require('just-clone');

const { zeroPad, getPathData } = require('./utils');

function joinBy(input, delim = ', ') {
  const arr = Array.isArray(input) ? input : [input];
  return arr.join(delim);
}

function fileFormatVolumes(value, key, { volumeNumberZeroPadding }) {
  return zeroPad(value, volumeNumberZeroPadding);
}

function fileFormatIssues(value, key, { issueNumberZeroPadding }) {
  return zeroPad(value, issueNumberZeroPadding);
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
  return `${outputFilePath}${ext}`;
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
    titleNamingConventions,
    seriesRoot,
    cleanedArchivePath,
  } = context;
  const titlePath = getOutputFilePath(
    titleNamingConventions,
    { ...clone(contentMetaData), ...clone(formatted) },
    seriesRoot,
    cleanedArchivePath,
  );
  formatted.title = titleFormatter(titlePath);
  const formattedAuthors = comicInfoFormatAuthors(contentMetaData, context);
  return { ...formatted, ...formattedAuthors };
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
  );
  // const formattedAuthors = fileFormatAuthors(contentMetaData, context);
  return { ...formatted };
}

module.exports = {
  getFileFormattedMetaData,
  getComicInfoFormattedMetaData,
  getOutputFilePath,
};
