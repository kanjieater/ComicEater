const { getOutputFilePath } = require('./series');

const testConfig = {
  root: '/mnt/w/collection/1 series/',
  archiveFileName: 'Kararesu v01.cbz',
  contentMetaData: {
    seriesName: 'Kararesu',
    volumeNumber: 1,
  },
  outputNamingConventions: [
    '{{root}}{{seriesName}}/{{seriesName}} - 第{{volumeNumber}}巻',
    '{{root}}{{seriesName}}/[{{authors}}] {{seriesName}} - 第{{volumeNumber}}巻',
  ],
};

test('getOutputFilePath should apply an outputNamingConvention based on the meta data and give back a string file path', () => {
  expect(
    getOutputFilePath(
      testConfig.outputNamingConventions,
      testConfig.contentMetaData,
      testConfig.root,
      testConfig.archiveFileName,
    ),
  ).toBe('/mnt/w/collection/1 series/Kararesu/Kararesu - 第1巻.cbz');
});
