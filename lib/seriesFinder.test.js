const { find, extractVolumeNumber, defaultConfig } = require('./seriesFinder');

test('seriesFinder.find removes configured junk', () => {
  expect(find('DLraw.net-Kararesu v01'))
    .toStrictEqual({
      seriesName: 'Kararesu',
      hasVolumeNumber: true,
      volumeNumber: 1,
    });
});

test('seriesFinder.find parse basic volume patterns', () => {
  expect(find('極東事変 第1巻'))
    .toStrictEqual({
      seriesName: '極東事変',
      hasVolumeNumber: true,
      volumeNumber: 1,
    });
});

test('seriesFinder.extractVolumeNumber parse basic volume patterns', () => {
  expect(extractVolumeNumber('極東事変 第1巻', defaultConfig.volumeNumberFilters))
    .toStrictEqual({
      updatedInput: '極東事変',
      hasVolumeNumber: true,
      volumeNumber: 1,
    });
});

// test('seriesFinder.find removes configured junk', () => {
//   expect(find('DLraw.net-Kararesu v01.rar')).toBe('Kararesu v01.rar');
// });
