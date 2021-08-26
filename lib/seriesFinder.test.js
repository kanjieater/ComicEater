const {
  find,
  extractVolumeNumber,
  getFolderMetaData,
  getFileMetaData,
} = require('./seriesFinder');

const testConfig = {
  junkToFilter: ['DLraw.net-'],
  volumeNumberFilters: ['v([0-9]*)', '- 第([0-9]*)', '第([0-9]*)', '([0-9]*)'],
};

const config = {
  root: '/mnt/w/collection/1 series/',
  archiveFileName: 'Kararesu v01.cbz',
  contentMetaData: {
    seriesName: 'Kararesu',
    volumeNumber: 1,
  },
  filePatterns: [
    '{{seriesName}}第{{volumeNumber}}',
    '{{seriesName}}',
  ],
  outputNamingConventions: [
    '{{root}}{{seriesName}}/{{seriesName}} - 第{{volumeNumber}}巻',
    '{{root}}{{seriesName}}/[{{authors}}] {{seriesName}} - 第{{volumeNumber}}巻',
  ],
};

test('getFileMetaData should parse config filePatterns into content meta data', () => {
  expect(getFileMetaData('極東事変 第1巻', config.filePatterns))
    .toStrictEqual({
      seriesName: '極東事変',
      volumeNumber: 1,
    });
});

test('seriesFinder.find removes configured junk', () => {
  expect(find('DLraw.net-Kararesu v01', testConfig))
    .toStrictEqual({
      seriesName: 'Kararesu',
      hasVolumeNumber: true,
      volumeNumber: 1,
    });
});

test('seriesFinder.find parse basic volume patterns', () => {
  expect(find('極東事変 第1巻', testConfig))
    .toStrictEqual({
      seriesName: '極東事変',
      hasVolumeNumber: true,
      volumeNumber: 1,
    });
});

test('seriesFinder.extractVolumeNumber parse basic volume patterns', () => {
  expect(extractVolumeNumber('極東事変 第1巻', testConfig.volumeNumberFilters))
    .toStrictEqual({
      updatedInput: '極東事変',
      hasVolumeNumber: true,
      volumeNumber: 1,
    });
});


