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
  seriesName: formatText,
  authors: formatText,
  year: formatVolumes,
};

function getFormattedContentMetaData(contentMetaData, config) {
  const formattedContentMetaData = {};
  Object.entries(contentMetaData).forEach(([key, value]) => {
    formattedContentMetaData[key] = formatters[key](value, config);
  });
  return formattedContentMetaData;
}

module.exports = {
  getFormattedContentMetaData,
};
