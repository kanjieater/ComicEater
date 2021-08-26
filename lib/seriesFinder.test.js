const { find, extractVolumeNumber, defaultConfig } = require('./seriesFinder');

const testConfig = {
  junkToFilter: ['DLraw.net-'],
  volumeNumberFilters: ['v([0-9]*)', '- 第([0-9]*)', '第([0-9]*)', '([0-9]*)'],
};

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

// test('seriesFinder.find removes configured junk', () => {
//   expect(find('DLraw.net-Kararesu v01.rar')).toBe('Kararesu v01.rar');
// });
