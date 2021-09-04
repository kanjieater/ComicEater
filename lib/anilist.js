const axios = require('axios');
const anilistnode = require('anilist-node/lib/index');
const { preferNative } = require('./utils');

// eslint-disable-next-line new-cap
const Anilist = new anilistnode();

const GET_DATA = `
query ($id: Int) {
  Media (id: $id, type: MANGA) {
    id
    title {
      romaji
      english
      native
    }
    genres
    description
    startDate {
      year
      month
      day
    }
    status
    staff {
      edges {
        id
        role
        node {
          name {
            full
            native
          }
        }
      }

    }
  }
}
      `;

async function callAnilist(id) {
  const response = await axios({
    url: 'https://graphql.anilist.co',
    method: 'post',
    data: {
      variables: { id },
      query: GET_DATA,
    },
  });
  return response?.data;
}

function getAuthorsWithRoles(authors) {
  const authorsWithRoles = {
    authors: [],
  };
  const authorMap = {
    Story: ['writer'],
    Art: ['inker', 'penciller'],
    'Story & Art': ['inker', 'penciller', 'writer'],
  };
  authors.forEach((author) => {
    if (Object.keys(authorMap).includes(author?.role)) {
      authorMap[author.role].forEach((key) => {
        if (authorsWithRoles[key]) {
          authorsWithRoles[key].push(author.name);
        } else {
          authorsWithRoles[key] = [author.name];
        }
      });
      authorsWithRoles.authors.push(author.name);
    }
  });

  if (Object.keys(authorsWithRoles).length === 0) {
    return false;
  }
  return authorsWithRoles;
}

async function formatStaff(staff, context) {
  if (staff === undefined || staff?.length === 0) {
    return false;
  }

  const authors = staff.map((edge) => {
    const author = {};
    let isDefined = false;
    if (edge?.role) {
      author.role = edge.role;
      isDefined = true;
    }
    if (edge?.node?.name) {
      const name = edge?.node?.name;
      if (name?.full && name?.native) {
        author.name = preferNative(name.native, name.full, context?.contentMetaData?.languageISO);
        isDefined = true;
      } else if (name?.native) {
        author.name = name?.native;
        isDefined = true;
      } else if (name?.full) {
        author.name = name?.full;
        isDefined = true;
      }
    }
    if (isDefined) {
      return author;
    }
    return false;
  }).filter((author) => author && author.name && author.role);

  return getAuthorsWithRoles(authors);
}

function formatStartDate(startDate) {
  const date = {};
  if (startDate === undefined) {
    return false;
  }
  let isDefined = false;
  if (startDate?.year) {
    date.publishYear = startDate.year;
    isDefined = true;
  }
  if (startDate?.month) {
    date.publishMonth = startDate.month;
    isDefined = true;
  }
  if (startDate?.day) {
    date.publishDay = startDate.day;
    isDefined = true;
  }
  if (isDefined) {
    return date;
  }
  return false;
}

function formatSeriesName(title, context) {
  if (!title) {
    return false;
  }
  const latinVersion = title?.english || title?.romaji;
  return preferNative(title?.native, latinVersion, context.contentMetaData.languageISO);
}

function formatStatus(status) {
  // Valid Statuses: ongoing, ended, hiatus, abandoned
  const map = {
    FINISHED: 'ended',
    RELEASING: 'ongoing',
    CANCELLED: 'abandoned',
    HIATUS: 'hiatus',
  };
  if (Object.keys(map).includes(status)) {
    return map[status];
  }
  return false;
}

function noop(input) {
  return input;
}

const formatters = {
  genres: noop,
  description: noop,
  status: formatStatus,
};

async function formatAnilistData(anilistResponse, context) {
  let formatted = {};
  Object.entries(anilistResponse).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(formatters, key)) {
      const newValue = formatters[key](value, key, context);
      if (newValue !== false) {
        formatted[key] = newValue;
      }
    }
  });
  const authors = await formatStaff(anilistResponse.staff?.edges, context);
  if (authors) {
    formatted = { ...formatted, ...authors };
  }
  const startDate = formatStartDate(anilistResponse?.startDate);
  if (startDate) {
    formatted = { ...formatted, ...startDate };
  }
  const seriesName = formatSeriesName(anilistResponse?.title, context);
  if (seriesName) {
    formatted.seriesName = seriesName;
  }
  return {
    ...formatted,
  };
}

async function searchAnilist(searchInput) {
  const anilistSearchResult = await Anilist.searchEntry.manga(searchInput);
  if (anilistSearchResult?.media?.length === 0) {
    return {};
  }
  const topResultId = anilistSearchResult.media[0].id;
  const mangaData = (await callAnilist(topResultId))?.data?.Media || {};
  return mangaData;
}

async function getAnilistData(context) {
  if (!context.contentMetaData.seriesName) {
    return {};
  }
  const anilistMetaData = await searchAnilist(context.contentMetaData.seriesName);
  const formattedData = await formatAnilistData(anilistMetaData, context);
  return { anilistMetaData, formattedData };
}

module.exports = {
  getAnilistData,
};
