const { find } = require('./seriesFinder');

test('seriesFinder.find removes configured junk', () => {
  expect(find('DLraw.net-Kararesu v01'))
  .toStrictEqual({ 
    series: 'Kararesu',
    hasIssueNumber: true,
    issueNumber: 1
  });
});

test('seriesFinder.find parse basic issue patterns', () => {
  expect(find('極東事変 第1巻'))
  .toStrictEqual({ 
    series: '極東事変',
    hasIssueNumber: true,
    issueNumber: 1
  });
});


// test('seriesFinder.find removes configured junk', () => {
//   expect(find('DLraw.net-Kararesu v01.rar')).toBe('Kararesu v01.rar');
// });
