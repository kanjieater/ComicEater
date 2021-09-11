const {
  getFolderMetaData,
  getFileMetaData,
  getTemplateMatches,
  getRegex,
} = require('./seriesFinder');

const { removeJunk } = require('./format');

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
    '[{{authors}}]{{seriesName}} - 第{{volumeNumber}}巻/**/*',
    '[{{authors}}]{{seriesName}}第{{volumeNumber}}巻/**/*',
    '{{seriesName}}({{volumeNumber}})/**/*',
    '{{seriesName}} v{{volumeNumber}}/**/*',
  ],
  outputNamingConventions: [
    '{{seriesRoot}}{{seriesName}}/{{seriesName}} - 第{{volumeNumber}}巻',
    '{{seriesRoot}}{{seriesName}}/[{{authors}}] {{seriesName}} - 第{{volumeNumber}}巻',
  ],
  splitAuthorsBy: [
    '×',
    '・',
    'ｘ',
    'x',
  ],
};

test('getFileMetaData should parse volumes meta data', () => {
  expect(getFileMetaData('Yokoshimakensanwa v01w-02s', ['{{seriesName}} {{volumeNumber}}']))
    .toStrictEqual({
      seriesName: 'Yokoshimakensanwa',
      volumeNumber: 1,
      volumeVariant: 'w',
      volumeRange: [{
        volumeNumber: 1,
        volumeVariant: 'w',
      },
      {
        volumeNumber: 2,
        volumeVariant: 's',
      }],

    });
});

test('getFileMetaData should parse config filePatterns into content meta data', () => {
  expect(getFileMetaData('Bentler Bentler 01w', ['{{seriesName}} {{volumeNumber}}']))
    .toStrictEqual({
      seriesName: 'Bentler Bentler',
      volumeNumber: 1,
      volumeVariant: 'w',
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
      volumeRange: [
        { volumeNumber: 1 }, { volumeNumber: 2 },
      ],
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
      totalVolumes: 1,
      authors: ['星野之宣'],
      writer: [
        '星野之宣',
      ],
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
      totalVolumes: 1,
      authors: ['星野之宣'],
      writer: [
        '星野之宣',
      ],
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
    authors: ['星野之宣'],
    writer: [
      '星野之宣',
    ],
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
    authors: ['星野之宣'],
    writer: [
      '星野之宣',
    ],
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
    writer: [
      '星野之宣] 未来 二つの顔 全01巻',
    ],
    authors: [
      '星野之宣] 未来 二つの顔 全01巻',
    ],
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
    totalVolumes: 1,
    authors: ['星野之宣'],
    writer: [
      '星野之宣',
    ],
    publishYear: 2022,
  });
});

test('getFolderMetaData should parse multiple authors by their delimeters', () => {
  expect(
    getFolderMetaData('[星野之宣×kanjieater] 未来の二つの顔 全01巻/',
      config.folderPatterns, { splitAuthorsBy: config.splitAuthorsBy }),
  )
    .toStrictEqual({
      seriesName: '未来の二つの顔',
      totalVolumes: 1,
      authors: ['星野之宣', 'kanjieater'],
      writer: [
        '星野之宣', 'kanjieater',
      ],
    });
});

test('getFolderMetaData should parse multiple authors by their delimeters', () => {
  expect(
    getFolderMetaData('[古屋兎丸x太宰治] 人間失格 - 第1巻/',
      config.folderPatterns, { splitAuthorsBy: config.splitAuthorsBy }),
  )
    .toStrictEqual({
      seriesName: '人間失格',
      volumeNumber: 1,
      authors: ['古屋兎丸', '太宰治'],
      writer: [
        '古屋兎丸', '太宰治',
      ],
    });
});

test('getFolderMetaData should parse config folderPatterns into content meta data with brackets', () => {
  expect(getFolderMetaData('[星野之宣] 未来の二つの顔 全01巻/', config.folderPatterns))
    .toStrictEqual({
      seriesName: '未来の二つの顔',
      authors: ['星野之宣'],
      writer: [
        '星野之宣',
      ],
      totalVolumes: 1,
    });
});

test('getFolderMetaData should parse config folderPatterns into content meta data with parenthesis', () => {
  expect(getFolderMetaData('邪剣さんはすぐブレる(1)/', config.folderPatterns))
    .toStrictEqual({
      seriesName: '邪剣さんはすぐブレる',
      volumeNumber: 1,
    });
});

test('find removes configured junk', () => {
  expect(removeJunk('./(一般コミック) Kararesu v01.cbz', config.junkToFilter))
    .toStrictEqual('./Kararesu v01.cbz');
});
