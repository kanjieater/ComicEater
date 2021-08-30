const clone = require('just-clone');

const { zeroPad, getPathData } = require('./utils');

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

function authorFormatter() {

}

function genresFormatter() {

}

function ageRatingFormatter() {

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
  inker: authorFormatter,
  coverArtist: authorFormatter,
  ageRating: ageRatingFormatter,
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
  return formatted;
}

module.exports = {
  titleFormatter,
  authorFormatter,
  genresFormatter,
  getFormattedContentMetaData,
  getOutputFilePath,
};
