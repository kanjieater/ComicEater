const {
  getFolderMetaData,
  getFileMetaData,
  removeJunk,
  getTemplateMatches,
  getRegex,
} = require('./seriesFinder');

const config = {
  junkToFilter: ['(一般コミック)'],
  seriesRoot: '/mnt/w/collection/1 series/',
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
    '[{{authors}}]{{seriesName}}全{{totalVolumes}}/**/*',
    '[{{authors}}]{{seriesName}}第{{volumeNumber}}巻/**/*',
    '{{seriesName}} v{{volumeNumber}}/**/*',
  ],
  outputNamingConventions: [
    '{{seriesRoot}}{{seriesName}}/{{seriesName}} - 第{{volumeNumber}}巻',
    '{{seriesRoot}}{{seriesName}}/[{{authors}}] {{seriesName}} - 第{{volumeNumber}}巻',
  ],
};

test('getFileMetaData should parse config filePatterns into content meta data', () => {
  expect(getFileMetaData('Bentler Bentler 01w', ['{{seriesName}} {{volumeNumber}}']))
    .toStrictEqual({
      seriesName: 'Bentler Bentler',
      volumeNumber: 1,
    });
});

test('getFolderMetaData should parse config filePatterns into content meta data but not across paths', () => {
  expect(
    getFolderMetaData(
      'Yumegenji Tsurugi no Saimon v01-02/Yumegenji Tsurugi no Saimon v01-02/',
      ['{{seriesName}} v{{volumeNumber}}/**/*'],
    ),
  )
    .toStrictEqual({
      seriesName: 'Yumegenji Tsurugi no Saimon',
      volumeNumber: 1,
    });
});

test('getFileMetaData should parse config filePatterns into content meta data for content with spaces', () => {
  expect(getFileMetaData('極東事変 第1巻', config.filePatterns))
    .toStrictEqual({
      seriesName: '極東事変',
      volumeNumber: 1,
    });
});

test('mapGlobToRegexStr should transform any end folder glob pattern into regex', () => {
  const patternTemplate = '[{{authors}}]{{seriesName}}全{{totalVolumes}}/**/*';
  const { allMatches } = getTemplateMatches(patternTemplate);
  expect(getRegex(allMatches, patternTemplate))
    .toStrictEqual(/^\[(?<authors>(?:[^/]?)+)\](?<seriesName>(?:[^/]?)+)全(?<totalVolumes>(?:[^/]?)+)\/(?:.*)$/);
});

test('mapGlobToRegexStr should transform any beginning folder glob pattern into regex', () => {
  const patternTemplate = '/**/[{{authors}}]{{seriesName}}全{{totalVolumes}}/**/*';
  const { allMatches } = getTemplateMatches(patternTemplate);
  expect(getRegex(allMatches, patternTemplate))
    .toStrictEqual(
      /^\/(?:.*)\/\[(?<authors>(?:[^/]?)+)\](?<seriesName>(?:[^/]?)+)全(?<totalVolumes>(?:[^/]?)+)\/(?:.*)$/,
    );
});

test('mapGlobToRegexStr should transform any center folder glob pattern into regex', () => {
  const patternTemplate = '/**/[{{authors}}]{{seriesName}}全{{totalVolumes}}/**/{{publishYear}}/*';
  const { allMatches } = getTemplateMatches(patternTemplate);
  expect(getRegex(allMatches, patternTemplate))
    .toStrictEqual(
      /^\/(?:.*)\/\[(?<authors>(?:[^/]?)+)\](?<seriesName>(?:[^/]?)+)全(?<totalVolumes>(?:[^/]?)+)\/(?:.*)\/(?<publishYear>(?:[^/]?)+)\/(?:.*)$/,
    );
});

test('getFolderMetaData should parse config folderPatterns into content meta data with brackets', () => {
  expect(getFolderMetaData('[星野之宣] 未来の二つの顔 全01巻/', config.folderPatterns))
    .toStrictEqual({
      seriesName: '未来の二つの顔',
      authors: '星野之宣',
      totalVolumes: 1,
    });
});

test('getFolderMetaData should parse config folderPatterns into content meta data with parenthesis', () => {
  expect(
    getFolderMetaData(
      '(星野之宣) 未来の二つの顔 全01巻/',
      ['({{authors}}){{seriesName}}全{{totalVolumes}}/**/*'],
    ),
  )
    .toStrictEqual({
      seriesName: '未来の二つの顔',
      authors: '星野之宣',
      totalVolumes: 1,
    });
});

test('getFolderMetaData should parse config folderPatterns into content meta data in different paths but ignore end globs that are unmatched', () => {
  expect(
    getFolderMetaData(
      '[星野之宣] 未来の二つの顔 全01巻/2024/asdf/asdfasdf/',
      ['[{{authors}}]{{seriesName}}全{{totalVolumes}}/{{publishYear}}/**/*'],
    ),
  ).toStrictEqual({
    seriesName: '未来の二つの顔',
    authors: '星野之宣',
    totalVolumes: 1,
    publishYear: 2024,
  });
});

test('getFolderMetaData should use lookaheads to get all characters up to the next non-pattern character', () => {
  expect(
    getFolderMetaData(
      '[星野之宣] 未来 二つの顔 全01巻/2024/asdf/asdfasdf/',
      ['[{{authors}}]{{seriesName}} {{totalVolumes}}/{{publishYear}}/**/*'],
    ),
  ).toStrictEqual({
    seriesName: '未来 二つの顔',
    authors: '星野之宣',
    totalVolumes: 1,
    publishYear: 2024,
  });
});

test('getFolderMetaData should parse a single template with */', () => {
  expect(
    getFolderMetaData(
      '[星野之宣] 未来 二つの顔 全01巻/2024/',
      ['[{{authors}}*/'],
    ),
  ).toStrictEqual({
    authors: '星野之宣] 未来 二つの顔 全01巻',
  });
});

test('getFolderMetaData should parse a single template with /*', () => {
  expect(
    getFolderMetaData(
      '[星野之宣] 未来 二つの顔 全01巻/asdf/2024/',
      ['**/*{{publishYear}}/'],
    ),
  ).toStrictEqual({
    publishYear: 2024,
  });
});

test('getFolderMetaData should not parse folders not in folderPatterns into content meta data in different paths', () => {
  expect(
    getFolderMetaData(
      '[星野之宣] 未来の二つの顔 全01巻/2024/2022/',

      ['[{{authors}}]{{seriesName}}全{{totalVolumes}}/**/{{publishYear}}/'],

    ),
  ).toStrictEqual({
    seriesName: '未来の二つの顔',
    authors: '星野之宣',
    totalVolumes: 1,
    publishYear: 2022,
  });
});

test('getFolderMetaData should parse config folderPatterns into content meta data with brackets', () => {
  expect(getFolderMetaData('[星野之宣] 未来の二つの顔 全01巻/', config.folderPatterns))
    .toStrictEqual({
      seriesName: '未来の二つの顔',
      authors: '星野之宣',
      totalVolumes: 1,
    });
});

test('find removes configured junk', () => {
  expect(removeJunk('./(一般コミック) Kararesu v01.cbz', config.junkToFilter))
    .toStrictEqual('./Kararesu v01.cbz');
});

// test('extractVolumeNumber parse basic volume patterns', () => {
//   expect(extractVolumeNumber('極東事変 第1巻', testConfig.volumeNumberFilters))
//     .toStrictEqual({
//       updatedInput: '極東事変',
//       hasVolumeNumber: true,
//       volumeNumber: 1,
//     });
// });
