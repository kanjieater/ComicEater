const clone = require('just-clone');
const { input } = require('./logger');

const { zeroPad, getPathData } = require('./utils');

function splitByComma(input) {
  const arr = Array.isArray(input) ? input : [input];
  return arr.join(', ');
}

function formatVolumes(value, { volumeNumberZeroPadding }) {
  return zeroPad(value, volumeNumberZeroPadding);
}

function formatIssues(value, { issueNumberZeroPadding }) {
  return zeroPad(value, issueNumberZeroPadding);
}

function formatText(value) {
  return value;
}

function titleFormatter(outputPath) {
  const { fileName } = getPathData(outputPath);
  return fileName;
}

function authorFormatter(contentMetaData) {
  const {
    inker, penciller, coverArtist, letterer, writer,
  } = contentMetaData;

  const authors = {
    inker, penciller, coverArtist, letterer, writer,
  };
  const hasOtherAuthors = Object.keys(authors).some((author) => !!author);
  const formattedAuthors = {};
  if (contentMetaData.authors && !hasOtherAuthors) {
    authors.writer = splitByComma(contentMetaData.authors);
  } else {
    Object.entries(([key, value]) => {
      if (key && value) {
        formattedAuthors[key] = splitByComma(value);
      }
    });
  }

  return authors;
}

function genresFormatter() {

}

function ageRatingFormatter() {

}

function noop(input) {
  return input;
}

const formatters = {
  issueNumber: formatIssues,
  volumeNumber: formatVolumes,
  totalVolumes: formatVolumes,
  year: formatVolumes,
  seriesName: formatText,
  authors: formatText,
  languageISO: formatText,
  manga: formatText,
  penciller: authorFormatter,
  writer: authorFormatter,
  inker: authorFormatter,
  coverArtist: authorFormatter,
  ageRating: ageRatingFormatter,
  formattedAuthors: noop,
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
  contentMetaData,
  formattedContentMetaData,
  seriesRoot,
  cleanedArchivePath,
) {
  let outputFilePath = false;
  const { fileName, ext } = getPathData(cleanedArchivePath);
  outputNamingConventions.find((outputNamingConvention) => {
    outputFilePath = applyTemplate(
      outputNamingConvention,
      {
        ...clone(contentMetaData),
        ...clone(formattedContentMetaData),
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

function getFormattedContentMetaData(contentMetaData, context) {
  const formatted = {};
  Object.entries(contentMetaData).forEach(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(formatters, key)) {
      throw new Error(`There is no currently available for formatter for ${key}. Try a different template variable name.`);
    }
    formatted[key] = formatters[key](value, context);
  });
  const {
    outputNamingConventions,
    titleNamingConventions,
    seriesRoot,
    cleanedArchivePath,
  } = context;
  formatted.outputFilePath = getOutputFilePath(
    outputNamingConventions,
    formatted,
    contentMetaData,
    seriesRoot,
    cleanedArchivePath,
  );
  const titlePath = getOutputFilePath(
    titleNamingConventions,
    formatted,
    contentMetaData,
    seriesRoot,
    cleanedArchivePath,
  );
  formatted.title = titleFormatter(titlePath);
  const formattedAuthors = authorFormatter(contentMetaData, context);
  return { ...formatted, ...formattedAuthors };
}

module.exports = {
  titleFormatter,
  authorFormatter,
  genresFormatter,
  getFormattedContentMetaData,
  getOutputFilePath,
};
