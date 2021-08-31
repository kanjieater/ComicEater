const clone = require('just-clone');

const { zeroPad, getPathData } = require('./utils');

function joinBy(input, delim = ', ') {
  const arr = Array.isArray(input) ? input : [input];
  return arr.join(delim);
}

function fileFormatVolumes(value, { volumeNumberZeroPadding }) {
  return zeroPad(value, volumeNumberZeroPadding);
}

function fileFormatIssues(value, { issueNumberZeroPadding }) {
  return zeroPad(value, issueNumberZeroPadding);
}

function formatText(value) {
  return value;
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

function genresFormatter(genres) {
  return joinBy(genres);
}

function ageRatingFormatter() {

}

function formatNumbers(input) {
  return input;
}

const comicInfoFormatters = {
  issueNumber: formatNumbers,
  volumeNumber: formatNumbers,
  seriesName: formatText,
  languageISO: formatText,
  manga: formatText,
  ageRating: ageRatingFormatter,
  genres: genresFormatter,
};

const fileFormatters = {
  issueNumber: fileFormatIssues,
  volumeNumber: fileFormatVolumes,
  authors: fileFormatAuthors,
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
      formatted[key] = comicInfoFormatters[key](value, key, context);
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
