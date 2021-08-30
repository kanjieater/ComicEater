const clone = require('just-clone');
const { getOutputFilePath } = require('./format');

const testConfig = {
  seriesRoot: '/mnt/w/collection/1 series/',
  archiveFileName: 'Kararesu v01.cbz',
  contentMetaData: {
    seriesName: 'Kararesu',
    volumeNumber: 1,
    authors: 'KENT',
  },
  outputNamingConventions: [
    '{{seriesRoot}}{{seriesName}}/[{{authors}}] {{seriesName}} - 第{{volumeNumber}}巻',
    '{{seriesRoot}}{{seriesName}}/{{seriesName}} - 第{{volumeNumber}}巻',
  ],
};

test('getOutputFilePath should apply an outputNamingConventions based on the meta data and give back a string file path', () => {
  expect(
    getOutputFilePath(
      testConfig.outputNamingConventions,
      { ...clone(testConfig.contentMetaData), volumeNumber: '01' },
      testConfig.seriesRoot,
      testConfig.archiveFileName,
    ),
  ).toBe('/mnt/w/collection/1 series/Kararesu/[KENT] Kararesu - 第01巻.cbz');
});

test('getOutputFilePath should not apply an outputNamingConventions if all of the template keys were not found', () => {
  expect(
    getOutputFilePath(
      testConfig.outputNamingConventions,
      {
        volumeNumber: 2,
        seriesName: '極東事変',
      },
      testConfig.seriesRoot,
      '極東事変.cbz',
    ),
  ).toBe('/mnt/w/collection/1 series/極東事変/極東事変 - 第2巻.cbz');
});
