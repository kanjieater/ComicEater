const {
  find,
  extractVolumeNumber,
  getFolderMetaData,
  getFileMetaData,
  removeJunk,
  mapGlobToRegexStr,
} = require('./seriesFinder');

const testConfig = {

  volumeNumberFilters: ['v([0-9]*)', '- 第([0-9]*)', '第([0-9]*)', '([0-9]*)'],
};

const config = {
  junkToFilter: ['(一般コミック)'],
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
  folderPatterns: [
    '[{{authors}}]{{seriesName}}全{{totalVolumesNumber}}/**/*',
    '[{{authors}}]{{seriesName}}第{{volumeNumber}}巻/**/*',
    '{{seriesName}} v{{volumeNumber}}/**/*',
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


test('mapGlobToRegexStr should transform any end folder glob pattern into regex', () => {
  expect(mapGlobToRegexStr('[{{authors}}]{{seriesName}}全{{totalVolumesNumber}}/**/*'))
    .toBe('^\\[{{authors}}\\]{{seriesName}}全{{totalVolumesNumber}}(\\/)(?:.*)$');
});

test('mapGlobToRegexStr should transform any beginning folder glob pattern into regex', () => {
  expect(mapGlobToRegexStr('/**/[{{authors}}]{{seriesName}}全{{totalVolumesNumber}}/**/*'))
    .toBe('^(\\/)(?:.*)(\\/)\\[{{authors}}\\]{{seriesName}}全{{totalVolumesNumber}}(\\/)(?:.*)$');
});

test('mapGlobToRegexStr should transform any center folder glob pattern into regex', () => {
  expect(mapGlobToRegexStr('/**/[{{authors}}]{{seriesName}}全{{totalVolumesNumber}}/**/{{year}}/*'))
    .toBe('^(\\/)(?:.*)(\\/)\\[{{authors}}\\]{{seriesName}}全{{totalVolumesNumber}}(\\/)(?:.*)(\\/){{year}}(\\/)(?:.*)$');
});

test('getFolderMetaData should parse config folderPatterns into content meta data with brackets', () => {
  expect(getFolderMetaData('[星野之宣] 未来の二つの顔 全01巻/', config.folderPatterns))
    .toStrictEqual({
      seriesName: '未来の二つの顔',
      authors: '星野之宣',
      totalVolumesNumber: 1,
    });
});

test('getFolderMetaData should parse config folderPatterns into content meta data with parenthesis', () => {
  expect(
    getFolderMetaData(
      '(星野之宣) 未来の二つの顔 全01巻/',
      ['({{authors}}){{seriesName}}全{{totalVolumesNumber}}/**/*'],
    ),
  )
    .toStrictEqual({
      seriesName: '未来の二つの顔',
      authors: '星野之宣',
      totalVolumesNumber: 1,
    });
});

test('getFolderMetaData should parse config folderPatterns into content meta data in different paths but ignore end globs that are unmatched', () => {
  expect(
    getFolderMetaData(
      '[星野之宣] 未来の二つの顔 全01巻/2024/asdf/asdfasdf/',
      ['[{{authors}}]{{seriesName}}全{{totalVolumesNumber}}/{{year}}/**/*'],
    ),
  ).toStrictEqual({
    seriesName: '未来の二つの顔',
    authors: '星野之宣',
    totalVolumesNumber: 1,
    year: 2024,
  });
});

test('getFolderMetaData should parse config folderPatterns into content meta data in different paths', () => {
  expect(
    getFolderMetaData(
      '[星野之宣] 未来の二つの顔 全01巻/2024/',

      ['[{{authors}}]{{seriesName}}全{{totalVolumesNumber}}/{{year}}/*'],
    ),
  ).toStrictEqual({
    seriesName: '未来の二つの顔',
    authors: '星野之宣',
    totalVolumesNumber: 1,
    year: 2024,
  });
});

test('getFolderMetaData should not parse folders not in folderPatterns into content meta data in different paths', () => {
  expect(
    getFolderMetaData(
      '[星野之宣] 未来の二つの顔 全01巻/2024/2022/',

      ['[{{authors}}]{{seriesName}}全{{totalVolumesNumber}}/**/{{year}}/'],

    ),
  ).toStrictEqual({
    seriesName: '未来の二つの顔',
    authors: '星野之宣',
    totalVolumesNumber: 1,
    year: 2022,
  });
});

test('getFolderMetaData should parse config folderPatterns into content meta data with brackets', () => {
  expect(getFolderMetaData('[星野之宣] 未来の二つの顔 全01巻/', config.folderPatterns))
    .toStrictEqual({
      seriesName: '未来の二つの顔',
      authors: '星野之宣',
      totalVolumesNumber: 1,
    });
});

test('find removes configured junk', () => {
  expect(removeJunk('(一般コミック) Kararesu v01', config.junkToFilter))
    .toStrictEqual('Kararesu v01');
});

test('extractVolumeNumber parse basic volume patterns', () => {
  expect(extractVolumeNumber('極東事変 第1巻', testConfig.volumeNumberFilters))
    .toStrictEqual({
      updatedInput: '極東事変',
      hasVolumeNumber: true,
      volumeNumber: 1,
    });
});
