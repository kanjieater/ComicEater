const { zeroPad } = require('./utils');

function formatVolumes(value, { volumeNumberZeroPadding }) {
  return zeroPad(value, volumeNumberZeroPadding);
}

function formatIssues(value, { issueNumberZeroPadding }) {
  return zeroPad(value, issueNumberZeroPadding);
}

function formatText(value) {
  return value;
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
};

function getFormattedContentMetaData(contentMetaData, config) {
  const formattedContentMetaData = {};
  Object.entries(contentMetaData).forEach(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(formatters, key)) {
      throw new Error(`There is no currently available for formatter for ${key}. Try a different template variable name.`);
    }
    formattedContentMetaData[key] = formatters[key](value, config);
  });
  return formattedContentMetaData;
}

module.exports = {
  getFormattedContentMetaData,
};
