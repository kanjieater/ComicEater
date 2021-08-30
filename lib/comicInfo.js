const js2xmlparser = require('js2xmlparser');
const { writeFile } = require('./files');
const log = require('./logger');
const { formatters } = require('./format');

const COMIC_INFO_FILE_NAME = 'ComicInfo.xml';

const xmlMap = {
  title: 'Title',
  seriesName: 'Series',
  volumeNumber: 'Number',
  issueNumber: 'Number',
  totalVolumes: 'Count',
  seriesYear: 'Volume',
  readList: 'AlternateSeries',
  alternateNumber: 'AlternateNumber',
  alternateCount: 'AlternateCount',
  summary: 'Summary',
  notes: 'Notes',
  publishYear: 'Year',
  publishMonth: 'Month',
  publishDay: 'Day',
  writer: 'Writer',
  penciller: 'Penciller',
  inker: 'Inker',
  colorist: 'Colorist',
  letterer: 'Letterer',
  coverArtist: 'CoverArtist',
  editor: 'Editor',
  publisher: 'Publisher',
  imprint: 'Imprint',
  genre: 'Genre',
  web: 'Web',
  pageCount: 'PageCount',
  languageISO: 'LanguageISO',
  format: 'Format',
  blackAndWhite: 'BlackAndWhite',
  manga: 'Manga',
  characters: 'Characters',
  teams: 'Teams',
  locations: 'Locations',
  scanInformation: 'ScanInformation',
  storyArc: 'StoryArc',
  seriesGroup: 'SeriesGroup',
  ageRating: 'AgeRating',
  pages: 'Pages',
};

// eslint-disable-next-line no-unused-vars
const notImplemented = {
  characters: 'Characters',
  teams: 'Teams',
  locations: 'Locations',
};

function shouldUseUnformatted(key) {
  const noFormatList = ['volumeNumber', 'issueNumber'];
  return noFormatList.includes(key);
}

function getFormattedXMLJSON(metaData, formattedContentMetaData) {
  const xmlFormat = {};
  Object.entries(xmlMap).forEach(([key, value]) => {
    const hasMetaData = Object.prototype.hasOwnProperty.call(metaData, key);
    const hasFormattedMetaData = Object.prototype.hasOwnProperty.call(
      formattedContentMetaData,
      key,
    );
    if (!hasMetaData && !hasFormattedMetaData) {
      return;
    }
    const isUnformatted = shouldUseUnformatted(key);
    if (isUnformatted && hasMetaData) {
      xmlFormat[value] = metaData[key];
    } else if (hasFormattedMetaData) {
      xmlFormat[value] = formattedContentMetaData[key];
    }
  });
  return xmlFormat;
}

function convertToXML(preppedMetaData) {
  log.debug(`Converting ${preppedMetaData} into XML`);
  return js2xmlparser.parse('ComicInfo', preppedMetaData);
}

async function writeComicInfo(metaData, formattedContentMetaData, fileDir) {
  const comicInfoOutputPath = `${fileDir}/${COMIC_INFO_FILE_NAME}`;
  const preppedMetaData = getFormattedXMLJSON(metaData, formattedContentMetaData);
  const xmlData = convertToXML(preppedMetaData);
  if (Object.keys(preppedMetaData) === 0) {
    log.debug(`There was no meta data to write to "${comicInfoOutputPath}"`);
    return null;
  }
  const writtenFile = await writeFile(xmlData, comicInfoOutputPath);
  log.debug(`Successfully wrote ${comicInfoOutputPath}`);
  return writtenFile;
}

module.exports = {
  writeComicInfo,
};
