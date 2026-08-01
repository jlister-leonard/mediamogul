import { describe, expect, it } from "vitest";
import {
  availabilitySchema,
  comparisonSchema,
  entrySchema,
  genreAssignmentSchema,
  genreSchema,
  gradientSchema,
  goodreadsManualMatchSchema,
  isoTimestampSchema,
  itemSchema,
  itemSeedSchema,
  mediaRefSchema,
  mediumSchema,
  portraitSchema,
  queueItemSchema,
  ratingModeSchema,
  recSchema,
  rejectionReasonSchema,
  situationSchema,
} from "./index";

describe("ids and timestamps", () => {
  it("accepts an ISO-8601 UTC timestamp as produced by toISOString()", () => {
    expect(
      isoTimestampSchema.safeParse(new Date().toISOString()).success,
    ).toBe(true);
  });

  it("rejects a bare date and a non-ISO string", () => {
    expect(isoTimestampSchema.safeParse("Jul 5, 2026").success).toBe(false);
    expect(isoTimestampSchema.safeParse("").success).toBe(false);
  });

  it("rejects every non-toISOString ISO form — offset, zoneless-local, no-millis", () => {
    expect(
      isoTimestampSchema.safeParse("2026-07-28T09:00:00.000+02:00").success,
    ).toBe(false);
    expect(
      isoTimestampSchema.safeParse("2026-07-28T09:00:00.000").success,
    ).toBe(false);
    expect(isoTimestampSchema.safeParse("2026-07-28T09:00:00Z").success).toBe(
      false,
    );
  });
});

describe("goodreadsManualMatchSchema", () => {
  const pending = {
    id: "goodreads:37485950",
    source: {
      rowNumber: 2,
      bookId: "37485950",
      title: "Reinventing Your Life",
      authors: ["Jeffrey E. Young"],
      invalidIsbns: [],
      dateAdded: "2026-05-09T00:00:00.000Z",
      shelves: [],
      shelfPositions: {},
      exclusiveShelf: "read",
      readCount: 1,
    },
    reason: "no-match",
    detail: "No confident catalog match was found",
    suggestedQuery: { title: "Reinventing Your Life", author: "Jeffrey E. Young" },
  };

  it("accepts all durable context needed to resume a manual match", () => {
    expect(goodreadsManualMatchSchema.safeParse(pending).success).toBe(true);
  });

  it("rejects a pending record with no stable Goodreads key or query", () => {
    expect(goodreadsManualMatchSchema.safeParse({ ...pending, id: "37485950" }).success).toBe(false);
    expect(goodreadsManualMatchSchema.safeParse({ ...pending, id: "goodreads:other" }).success).toBe(false);
    expect(goodreadsManualMatchSchema.safeParse({ ...pending, suggestedQuery: {} }).success).toBe(false);
  });
});

describe("mediaRefSchema", () => {
  it("accepts a book ref carrying an ISBN13", () => {
    expect(
      mediaRefSchema.safeParse({ medium: "book", isbn13: "9781524731656" })
        .success,
    ).toBe(true);
  });

  it("accepts a podcast ref with only a Spotify show id", () => {
    expect(
      mediaRefSchema.safeParse({
        medium: "podcast",
        spotifyShowId: "7Fj0XffcRIhr9uhSKmdiaB",
      }).success,
    ).toBe(true);
  });

  it("rejects a book ref with no external ids at all", () => {
    expect(mediaRefSchema.safeParse({ medium: "book" }).success).toBe(false);
  });

  it("rejects a movie ref missing its tmdbId", () => {
    expect(mediaRefSchema.safeParse({ medium: "movie" }).success).toBe(false);
  });

  it("rejects an unknown medium", () => {
    expect(
      mediumSchema.safeParse("album").success,
      "albums are not a Nightstand medium",
    ).toBe(false);
  });
});

describe("itemSchema", () => {
  const badBlood = {
    id: "item-bad-blood",
    medium: "book",
    ref: { medium: "book", isbn13: "9781524731656" },
    title: "Bad Blood",
    subtitle: "Secrets and Lies in a Silicon Valley Startup",
    creators: ["John Carreyrou"],
    year: 2018,
    artUrl: "https://covers.openlibrary.org/b/isbn/9781524731656-L.jpg",
    description:
      "The full inside story of the breathtaking rise and shocking collapse of Theranos.",
    communityRating: {
      average: 4.4,
      count: 312450,
      histogram: [2100, 4800, 21500, 98050, 186000],
    },
    genre: { genre: "money-markets", source: "auto" },
    pages: 339,
  };

  it("accepts a realistic book item from the seed corpus", () => {
    expect(itemSchema.safeParse(badBlood).success).toBe(true);
  });

  it("accepts a realistic TV item with an episode runtime", () => {
    expect(
      itemSchema.safeParse({
        id: "item-the-bear",
        medium: "tv",
        ref: { medium: "tv", tmdbId: 136315 },
        title: "The Bear",
        creators: ["Christopher Storer"],
        year: 2022,
        runtimeMinutes: 30,
      }).success,
    ).toBe(true);
  });

  it("rejects a book item whose ref claims to be a movie", () => {
    expect(
      itemSchema.safeParse({
        ...badBlood,
        ref: { medium: "movie", tmdbId: 106646 },
      }).success,
    ).toBe(false);
  });

  it("rejects an item missing its title", () => {
    expect(
      itemSchema.safeParse({ ...badBlood, title: undefined }).success,
    ).toBe(false);
  });

  it("rejects a four-bucket community histogram — the distribution is 1★ through 5★", () => {
    expect(
      itemSchema.safeParse({
        ...badBlood,
        communityRating: { average: 4.4, count: 10, histogram: [1, 2, 3, 4] },
      }).success,
    ).toBe(false);
  });
});

describe("itemSeedSchema", () => {
  it("accepts a provider-normalized search result — no id, no genre yet", () => {
    expect(
      itemSeedSchema.safeParse({
        medium: "movie",
        ref: { medium: "movie", tmdbId: 106646 },
        title: "The Wolf of Wall Street",
        creators: ["Martin Scorsese"],
        year: 2013,
        runtimeMinutes: 180,
        communityRating: { average: 8.0, count: 22000 },
      }).success,
    ).toBe(true);
  });

  it("rejects a seed missing its ref — providers must resolve identity", () => {
    expect(
      itemSeedSchema.safeParse({
        medium: "podcast",
        title: "Acquired",
        creators: ["Ben Gilbert", "David Rosenthal"],
      }).success,
    ).toBe(false);
  });
});

describe("genre", () => {
  it("accepts every documented ladder and a manual assignment override", () => {
    expect(genreSchema.safeParse("comfort-childhood").success).toBe(true);
    expect(
      genreAssignmentSchema.safeParse({
        genre: "auteur-prestige",
        source: "manual",
      }).success,
    ).toBe(true);
  });

  it("rejects an undocumented ladder and an unknown assignment source", () => {
    expect(genreSchema.safeParse("romance").success).toBe(false);
    expect(
      genreAssignmentSchema.safeParse({
        genre: "lives",
        source: "guessed",
      }).success,
    ).toBe(false);
  });
});

describe("entrySchema", () => {
  it("accepts a finished, rated entry with taste tags and no dates", () => {
    expect(
      entrySchema.safeParse({
        id: "entry-1",
        itemId: "item-bad-blood",
        status: "finished",
        gradient: "loved",
        mode: "admired",
        score: 1642,
        tags: ["pacing", "voice"],
        note: "The fork in the road chapter wrecked me.",
      }).success,
    ).toBe(true);
  });

  it("accepts a comfort-mode entry (loved-since-childhood)", () => {
    expect(
      entrySchema.safeParse({
        id: "entry-2",
        itemId: "item-green-eggs",
        status: "finished",
        gradient: "loved",
        mode: "comfort",
        tags: [],
      }).success,
    ).toBe(true);
  });

  it("rejects a five-star rating — stars are not the contract", () => {
    expect(gradientSchema.safeParse(5).success).toBe(false);
    expect(gradientSchema.safeParse("meh").success).toBe(false);
  });

  it("rejects an unknown rating mode and a missing status", () => {
    expect(ratingModeSchema.safeParse("nostalgic").success).toBe(false);
    expect(
      entrySchema.safeParse({
        id: "entry-3",
        itemId: "item-x",
        tags: [],
      }).success,
    ).toBe(false);
  });
});

describe("comparisonSchema", () => {
  it("accepts a duel inside one genre pool", () => {
    expect(
      comparisonSchema.safeParse({
        id: "cmp-1",
        genre: "business-strategy",
        winnerId: "item-inside-the-tornado",
        loserId: "item-blue-ocean-strategy",
        comparedAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects a self-duel", () => {
    expect(
      comparisonSchema.safeParse({
        id: "cmp-2",
        genre: "lives",
        winnerId: "item-steve-jobs",
        loserId: "item-steve-jobs",
        comparedAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects a duel without a genre pool — no cross-genre duels exist", () => {
    expect(
      comparisonSchema.safeParse({
        id: "cmp-3",
        winnerId: "item-a",
        loserId: "item-b",
        comparedAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("queueItemSchema", () => {
  it("accepts a stack item with context tags instead of DATE ADDED prominence", () => {
    expect(
      queueItemSchema.safeParse({
        id: "q-1",
        itemId: "item-the-road",
        contextTags: ["flight"],
        addedReason: "the literary outlier worth testing Finding 4 against",
        addedAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects a stack item pointing at nothing", () => {
    expect(
      queueItemSchema.safeParse({
        id: "q-2",
        contextTags: [],
        addedAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("situationSchema", () => {
  it("accepts a built-in chip and a chat-saved situation", () => {
    expect(
      situationSchema.safeParse({
        id: "sit-1",
        label: "45 min before bed",
        prompt: "45 minutes before bed, nothing heavy",
        source: "built-in",
        createdAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      situationSchema.safeParse({
        id: "sit-2",
        label: "absorbing flight read",
        prompt:
          "Flight tomorrow, 5 hours, want something absorbing but I'm burned out on business books",
        source: "chat",
        createdAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown source and an empty label", () => {
    expect(
      situationSchema.safeParse({
        id: "sit-3",
        label: "",
        prompt: "x",
        source: "imported",
        createdAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("availabilitySchema", () => {
  const base = {
    itemId: "item-wolf-of-wall-street",
    region: "US",
    fetchedAt: "2026-07-28T09:00:00.000Z",
  };

  it("accepts subscription, rent (with price), and theater offers", () => {
    expect(
      availabilitySchema.safeParse({
        ...base,
        kind: "subscription",
        providerId: "netflix",
        url: "https://www.netflix.com/title/70266676",
      }).success,
    ).toBe(true);
    expect(
      availabilitySchema.safeParse({
        ...base,
        kind: "rent",
        providerId: "prime-video",
        priceUsd: 3.99,
      }).success,
    ).toBe(true);
    expect(
      availabilitySchema.safeParse({
        ...base,
        kind: "theater",
        fandangoUrl:
          "https://www.fandango.com/one-battle-after-another/movie-overview",
      }).success,
    ).toBe(true);
  });

  it("rejects 'borrow' — Libby was dropped by decision #11", () => {
    expect(
      availabilitySchema.safeParse({
        ...base,
        kind: "borrow",
        providerId: "libby",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-US region and a subscription offer without a provider", () => {
    expect(
      availabilitySchema.safeParse({
        ...base,
        region: "GB",
        kind: "subscription",
        providerId: "netflix",
      }).success,
    ).toBe(false);
    expect(
      availabilitySchema.safeParse({ ...base, kind: "subscription" }).success,
    ).toBe(false);
  });
});

describe("recSchema", () => {
  it("accepts a hand-dealt rec whose reason cites your history", () => {
    expect(
      recSchema.safeParse({
        id: "rec-1",
        itemId: "item-number-go-up",
        reason:
          "you ranked Bad Blood top of Money & Markets; this is the same reporter",
        source: { entry: "hand" },
        dealtAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("accepts a situation-dealt rec rejected as too-long", () => {
    expect(
      recSchema.safeParse({
        id: "rec-2",
        itemId: "item-security-analysis",
        reason: "top of your to-read finance cluster",
        source: { entry: "situation", situationId: "sit-1" },
        dealtAt: "2026-07-28T09:00:00.000Z",
        rejection: {
          reason: "too-long",
          at: "2026-07-28T09:05:00.000Z",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects an empty reason — recs cite your history or they don't ship", () => {
    expect(
      recSchema.safeParse({
        id: "rec-3",
        itemId: "item-x",
        reason: "",
        source: { entry: "chat" },
        dealtAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects an undocumented rejection reason and a situation source without an id", () => {
    expect(rejectionReasonSchema.safeParse("boring").success).toBe(false);
    expect(
      recSchema.safeParse({
        id: "rec-4",
        itemId: "item-x",
        reason: "fits the 45 minutes",
        source: { entry: "situation" },
        dealtAt: "2026-07-28T09:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("portraitSchema", () => {
  it("accepts a versioned portrait with axis and prose claims, corrections, and the canon answer", () => {
    expect(
      portraitSchema.safeParse({
        version: 3,
        synthesizedAt: "2026-07-28T09:00:00.000Z",
        claims: [
          {
            kind: "axis",
            left: "plot-driven",
            right: "vibe-driven",
            position: -0.6,
          },
          {
            kind: "obsession",
            text: "Investigation structure — Bad Blood, Knives Out, and the podcasts all circle it.",
          },
          {
            kind: "blind-spot",
            text: "Almost no fiction published after 1990 outside thrillers.",
          },
        ],
        corrections: [
          {
            claim: {
              kind: "blind-spot",
              text: "Avoids literary fiction permanently.",
            },
            note: "The Road is on the stack — it was assigned reading, not taste.",
            at: "2026-07-28T09:10:00.000Z",
          },
        ],
        assignedCanon: "the-circumstance",
      }).success,
    ).toBe(true);
  });

  it("rejects an axis leaning outside [-1, 1] and an unknown claim kind", () => {
    expect(
      portraitSchema.safeParse({
        version: 1,
        synthesizedAt: "2026-07-28T09:00:00.000Z",
        claims: [
          { kind: "axis", left: "comfort", right: "challenge", position: 2 },
        ],
        corrections: [],
      }).success,
    ).toBe(false);
    expect(
      portraitSchema.safeParse({
        version: 1,
        synthesizedAt: "2026-07-28T09:00:00.000Z",
        claims: [{ kind: "star-sign", text: "a Scorpio reader" }],
        corrections: [],
      }).success,
    ).toBe(false);
  });

  it("rejects a correction whose claim is a bare string — corrections snapshot the claim object", () => {
    expect(
      portraitSchema.safeParse({
        version: 2,
        synthesizedAt: "2026-07-28T09:00:00.000Z",
        claims: [],
        corrections: [
          {
            claim: "Avoids literary fiction permanently.",
            at: "2026-07-28T09:10:00.000Z",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects version zero — versions start at 1", () => {
    expect(
      portraitSchema.safeParse({
        version: 0,
        synthesizedAt: "2026-07-28T09:00:00.000Z",
        claims: [],
        corrections: [],
      }).success,
    ).toBe(false);
  });
});
