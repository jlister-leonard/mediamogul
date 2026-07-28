/**
 * Fixtures for the podcast provider (E2.3).
 *
 * PROVENANCE: hand-built field-for-field from the documented upstream shapes —
 * Apple's iTunes Search API documentation (media=podcast, entity=podcast /
 * lookup) and Spotify's Web API reference (client-credentials token endpoint
 * and GET /v1/search?type=show). itunes.apple.com is unreachable from the
 * build environment and Spotify needs credentials we do not hold, so these are
 * NOT captured live responses: show titles/publishers are real, ids and asset
 * URLs are realistic placeholders in the documented formats. The env-gated
 * live smokes in podcasts.live.test.ts verify the real wire shapes wherever
 * egress and credentials exist.
 */

/** iTunes /search?media=podcast&entity=podcast — two shows. */
export const itunesSearchTwoShows = {
  resultCount: 2,
  results: [
    {
      wrapperType: "track",
      kind: "podcast",
      artistId: 121676617,
      collectionId: 394775318,
      trackId: 394775318,
      artistName: "Roman Mars",
      collectionName: "99% Invisible",
      trackName: "99% Invisible",
      collectionCensoredName: "99% Invisible",
      trackCensoredName: "99% Invisible",
      collectionViewUrl:
        "https://podcasts.apple.com/us/podcast/99-invisible/id394775318?uo=4",
      feedUrl: "https://feeds.simplecast.com/BqbsxVfO",
      trackViewUrl:
        "https://podcasts.apple.com/us/podcast/99-invisible/id394775318?uo=4",
      artworkUrl30:
        "https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/aa/bb/cc/aabbcc00-0000-0000-0000-000000000001/mza_1.jpg/30x30bb.jpg",
      artworkUrl60:
        "https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/aa/bb/cc/aabbcc00-0000-0000-0000-000000000001/mza_1.jpg/60x60bb.jpg",
      artworkUrl100:
        "https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/aa/bb/cc/aabbcc00-0000-0000-0000-000000000001/mza_1.jpg/100x100bb.jpg",
      artworkUrl600:
        "https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/aa/bb/cc/aabbcc00-0000-0000-0000-000000000001/mza_1.jpg/600x600bb.jpg",
      collectionPrice: 0,
      trackPrice: 0,
      collectionHqPrice: 0,
      releaseDate: "2026-07-22T21:24:00Z",
      collectionExplicitness: "notExplicit",
      trackExplicitness: "cleaned",
      trackCount: 634,
      trackTimeMillis: 1902000,
      country: "USA",
      currency: "USD",
      primaryGenreName: "Design",
      contentAdvisoryRating: "Clean",
      genreIds: ["1402", "26", "1301"],
      genres: ["Design", "Podcasts", "Arts"],
    },
    {
      wrapperType: "track",
      kind: "podcast",
      collectionId: 299436963,
      trackId: 299436963,
      artistName: "Nate DiMeo",
      collectionName: "The Memory Palace",
      trackName: "The Memory Palace",
      collectionViewUrl:
        "https://podcasts.apple.com/us/podcast/the-memory-palace/id299436963?uo=4",
      feedUrl: "https://feeds.megaphone.fm/memorypalace",
      trackViewUrl:
        "https://podcasts.apple.com/us/podcast/the-memory-palace/id299436963?uo=4",
      // No artworkUrl600: exercises largest-available fallback to 100px.
      artworkUrl30:
        "https://is1-ssl.mzstatic.com/image/thumb/Podcasts126/v4/dd/ee/ff/ddeeff00-0000-0000-0000-000000000002/mza_2.jpg/30x30bb.jpg",
      artworkUrl60:
        "https://is1-ssl.mzstatic.com/image/thumb/Podcasts126/v4/dd/ee/ff/ddeeff00-0000-0000-0000-000000000002/mza_2.jpg/60x60bb.jpg",
      artworkUrl100:
        "https://is1-ssl.mzstatic.com/image/thumb/Podcasts126/v4/dd/ee/ff/ddeeff00-0000-0000-0000-000000000002/mza_2.jpg/100x100bb.jpg",
      releaseDate: "2026-07-15T10:00:00Z",
      collectionExplicitness: "notExplicit",
      trackExplicitness: "cleaned",
      trackCount: 212,
      country: "USA",
      currency: "USD",
      primaryGenreName: "History",
      genreIds: ["1487", "26"],
      genres: ["History", "Podcasts"],
    },
  ],
};

/**
 * iTunes response containing a stray episode result (kind "podcast-episode",
 * per Apple's documented episode shape) between two shows. entity=podcast
 * should preclude this, but decision #2 — shows only, never episodes — is
 * enforced by the normalizer, not assumed of the upstream.
 */
export const itunesSearchWithEpisode = {
  resultCount: 2,
  results: [
    itunesSearchTwoShows.results[0],
    {
      wrapperType: "podcastEpisode",
      kind: "podcast-episode",
      collectionId: 394775318,
      trackId: 1000700000001,
      artistName: "Roman Mars",
      collectionName: "99% Invisible",
      trackName: "The Power Broker #99",
      releaseDate: "2026-07-22T21:24:00Z",
      episodeUrl: "https://audio.example.com/99pi/episode-634.mp3",
      trackTimeMillis: 1902000,
      episodeGuid: "gid://art19-episode-locator/V0/placeholder",
      description: "An episode-level description that must never become a seed.",
      genres: [{ name: "Design", id: "1402" }],
    },
  ],
};

/** iTunes /lookup?id=394775318&entity=podcast — single show. */
export const itunesLookupOneShow = {
  resultCount: 1,
  results: [itunesSearchTwoShows.results[0]],
};

/** iTunes /lookup for an id that matches nothing. */
export const itunesLookupEmpty = { resultCount: 0, results: [] };

/** Top-level shape violation: `results` is not an array. */
export const itunesMalformedResponse = { resultCount: 1, results: "nope" };

/** A show result missing its required collectionId. */
export const itunesMalformedShow = {
  resultCount: 1,
  results: [
    {
      wrapperType: "track",
      kind: "podcast",
      artistName: "Roman Mars",
      collectionName: "99% Invisible",
    },
  ],
};

/** Spotify client-credentials token response (accounts.spotify.com/api/token). */
export const spotifyTokenResponse = {
  access_token: "BQDfixture-token-not-real-0000000000000000000000",
  token_type: "Bearer",
  expires_in: 3600,
};

/**
 * Spotify GET /v1/search?type=show for "99% Invisible": the real show plus a
 * near-miss, and a leading null (Spotify documents nullable item slots).
 * The show id is a placeholder in Spotify's 22-char base62 format.
 */
export const spotifySearchMatch = {
  shows: {
    href: "https://api.spotify.com/v1/search?query=99%25%20Invisible&type=show&market=US&offset=0&limit=5",
    limit: 5,
    next: null,
    offset: 0,
    previous: null,
    total: 2,
    items: [
      null,
      {
        available_markets: ["US"],
        copyrights: [],
        description:
          "Design is everywhere in our lives, perhaps most importantly in the places where we've just stopped noticing.",
        html_description:
          "<p>Design is everywhere in our lives, perhaps most importantly in the places where we&#39;ve just stopped noticing.</p>",
        explicit: false,
        external_urls: {
          spotify: "https://open.spotify.com/show/2vjzeqQaEPCn7UBM8mNa1a",
        },
        href: "https://api.spotify.com/v1/shows/2vjzeqQaEPCn7UBM8mNa1a",
        id: "2vjzeqQaEPCn7UBM8mNa1a",
        images: [
          {
            url: "https://i.scdn.co/image/ab6765630000ba8a0000000000000000000000a1",
            height: 640,
            width: 640,
          },
          {
            url: "https://i.scdn.co/image/ab67656300005f1f0000000000000000000000a1",
            height: 300,
            width: 300,
          },
        ],
        is_externally_hosted: false,
        languages: ["en"],
        media_type: "audio",
        name: "99% Invisible",
        publisher: "Roman Mars",
        type: "show",
        total_episodes: 634,
        uri: "spotify:show:2vjzeqQaEPCn7UBM8mNa1a",
      },
      {
        available_markets: ["US"],
        copyrights: [],
        description: "A different show about design, not the one we want.",
        html_description:
          "<p>A different show about design, not the one we want.</p>",
        explicit: false,
        external_urls: {
          spotify: "https://open.spotify.com/show/0decoy0decoy0decoy0dec",
        },
        href: "https://api.spotify.com/v1/shows/0decoy0decoy0decoy0dec",
        id: "0decoy0decoy0decoy0dec",
        images: [],
        is_externally_hosted: false,
        languages: ["en"],
        media_type: "audio",
        name: "99% Visible",
        publisher: "Somebody Else",
        type: "show",
        total_episodes: 12,
        uri: "spotify:show:0decoy0decoy0decoy0dec",
      },
    ],
  },
};

/**
 * Spotify search whose only title match carries the WRONG publisher: querying
 * "The Daily" (The New York Times) finds a same-title show by someone else.
 * A confident match must veto on publisher — absent beats wrong.
 */
export const spotifySearchWrongPublisher = {
  shows: {
    href: "https://api.spotify.com/v1/search?query=The%20Daily&type=show&market=US&offset=0&limit=5",
    limit: 5,
    next: null,
    offset: 0,
    previous: null,
    total: 1,
    items: [
      {
        available_markets: ["US"],
        copyrights: [],
        description: "Two bros talk about their day. Daily.",
        html_description: "<p>Two bros talk about their day. Daily.</p>",
        explicit: false,
        external_urls: {
          spotify: "https://open.spotify.com/show/5impost5impost5impost5",
        },
        href: "https://api.spotify.com/v1/shows/5impost5impost5impost5",
        id: "5impost5impost5impost5",
        images: [],
        is_externally_hosted: false,
        languages: ["en"],
        media_type: "audio",
        name: "The Daily",
        publisher: "Podcast Bros LLC",
        type: "show",
        total_episodes: 87,
        uri: "spotify:show:5impost5impost5impost5",
      },
    ],
  },
};

/** Spotify search with no title match for the queried show. */
export const spotifySearchNoMatch = {
  shows: {
    href: "https://api.spotify.com/v1/search?query=The%20Memory%20Palace&type=show&market=US&offset=0&limit=5",
    limit: 5,
    next: null,
    offset: 0,
    previous: null,
    total: 1,
    items: [
      {
        available_markets: ["US"],
        copyrights: [],
        description: "Not the memory palace you were looking for.",
        html_description: "<p>Not the memory palace you were looking for.</p>",
        explicit: false,
        external_urls: {
          spotify: "https://open.spotify.com/show/1other1other1other1oth",
        },
        href: "https://api.spotify.com/v1/shows/1other1other1other1oth",
        id: "1other1other1other1oth",
        images: [],
        is_externally_hosted: false,
        languages: ["en"],
        media_type: "audio",
        name: "Memory Palace Meditations",
        publisher: "Someone Different",
        type: "show",
        total_episodes: 40,
        uri: "spotify:show:1other1other1other1oth",
      },
    ],
  },
};
