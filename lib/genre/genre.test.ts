import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { addItem, getItem, setItemGenre } from "../db/repo";
import { modeFromRow } from "../import/goodreads";
import { itemSchema, type Item, type ItemSeed } from "../types";
import {
  GOODREADS_BOOK_ID_SHA256,
  GOODREADS_EXPECTED_GENRES,
} from "./fixtures/goodreads-expectations";
import { TASTE_FILMS } from "./fixtures/taste-films";
import { applyAutoGenre, BOOK_GENRES, classifyGenre } from "./index";

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (char === "\n" && !quoted) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

const [header, ...sourceRows] = parseCsv(
  readFileSync("data/goodreads_library_export.csv", "utf8"),
);
const column = Object.fromEntries(header.map((name, index) => [name, index]));
const value = (row: string[], name: string) => row[column[name] ?? -1] ?? "";

const corpus: Item[] = sourceRows.map((row) => {
  const id = value(row, "Book Id");
  const additional = value(row, "Additional Authors")
    .split(",")
    .map((author) => author.trim())
    .filter(Boolean);
  const originalYear = Number(value(row, "Original Publication Year"));
  return itemSchema.parse({
    id: `item-goodreads-${id}`,
    medium: "book",
    title: value(row, "Title"),
    creators: [value(row, "Author"), ...additional],
    ...(Number.isInteger(originalYear) && originalYear !== 0
      ? { year: originalYear }
      : {}),
    ref: { medium: "book", openLibraryId: `goodreads-${id}` },
  });
});

const decisionForTitle = (title: string) =>
  classifyGenre(
    itemSchema.parse({
      id: `item-${title.toLowerCase().replace(/\W+/g, "-")}`,
      medium: "book",
      title,
      creators: [],
      ref: { medium: "book", openLibraryId: "test" },
    }),
  );

describe("deterministic genre assignment", () => {
  it("pins the reviewed 225-row audit to the exact Goodreads source order", () => {
    expect(corpus).toHaveLength(225);
    expect(GOODREADS_EXPECTED_GENRES).toHaveLength(225);
    expect(
      createHash("sha256")
        .update(sourceRows.map((row) => value(row, "Book Id")).join("\n"))
        .digest("hex"),
    ).toBe(GOODREADS_BOOK_ID_SHA256);
  });

  it("matches at least 90% of the independently reviewed seed expectations", () => {
    const mismatches = corpus.flatMap((item, index) => {
      const actual = classifyGenre(item).assignment.genre;
      const expected = GOODREADS_EXPECTED_GENRES[index];
      return actual === expected ? [] : [{ title: item.title, expected, actual }];
    });
    const accuracy = (corpus.length - mismatches.length) / corpus.length;
    expect(
      accuracy,
      `accuracy=${accuracy.toFixed(3)} mismatches=${JSON.stringify(mismatches)}`,
    ).toBeGreaterThanOrEqual(0.9);
  });

  it("assigns every seed book to exactly one of the eight locked ladders with an explanation", () => {
    for (const item of corpus) {
      const decision = classifyGenre(item);
      expect(BOOK_GENRES).toContain(decision.assignment.genre);
      expect(decision.rule).not.toHaveLength(0);
      expect(decision.evidence.length).toBeGreaterThan(0);
    }
  });

  it("keeps the critical wilderness and school-context anchors in their intended ladders", () => {
    expect(decisionForTitle("Into Thin Air").assignment.genre).toBe(
      "grit-wilderness",
    );
    for (const title of [
      "Catch-22",
      "The Canterbury Tales",
      "Heart of Darkness",
      "Macbeth",
      "Romeo and Juliet",
      "A Streetcar Named Desire",
      "Invisible Man",
      "The Scarlet Letter",
      "Brave New World",
      "Flowers for Algernon",
    ]) {
      expect(decisionForTitle(title).assignment.genre, title).toBe(
        "literary-fiction",
      );
    }
  });

  it("keeps all seven documented business queue titles ahead of generic market words", () => {
    for (const title of [
      "7 Powers",
      "Blue Ocean Strategy",
      "Positioning",
      "The Innovator’s Solution",
      "Inside the Tornado",
      "The Founder’s Dilemmas",
      "Unscalable",
    ]) {
      const item = itemSchema.parse({
        id: `item-queue-${title.length}`,
        medium: "book",
        title,
        subtitle: "A market economics series",
        creators: [],
        ref: { medium: "book", openLibraryId: title },
      });
      expect(classifyGenre(item).assignment.genre, title).toBe(
        "business-strategy",
      );
    }
  });

  it("separates Oh Places genre from rating mode and limits comfort to evidenced titles", () => {
    expect(decisionForTitle("Oh, the Places You’ll Go!").assignment.genre).toBe(
      "genre-fiction",
    );
    expect(
      modeFromRow({
        title: "Oh, the Places You’ll Go!",
        authors: ["Dr. Seuss"],
        rating: 4,
      }),
    ).toBe("enjoyed");
    expect(decisionForTitle("Green Eggs and Ham").assignment.genre).toBe(
      "comfort-childhood",
    );
    expect(decisionForTitle("The Cat in the Hat").assignment.genre).toBe(
      "comfort-childhood",
    );
    for (const [title, creator] of [
      ["The Casual Vacancy", "J.K. Rowling"],
      ["Magpie Murders", "Anthony Horowitz"],
      ["The Butter Battle Book", "Dr. Seuss"],
    ] as const) {
      const item = itemSchema.parse({
        id: `item-non-comfort-${title.length}`,
        medium: "book",
        title,
        creators: [creator],
        ref: { medium: "book", openLibraryId: title },
      });
      expect(classifyGenre(item).assignment.genre, title).not.toBe(
        "comfort-childhood",
      );
    }
  });

  it("puts exact Lives titles ahead of broad Business metadata without blanketing Coach K", () => {
    for (const title of [
      "Steve Jobs",
      "Elon Musk",
      "American Prometheus",
      "Founders at Work: Stories of Startups' Early Days",
      "Leadership: In Turbulent Times",
      "Leading with the Heart: Coach K's Successful Strategies for Basketball, Business, and Life",
    ]) {
      const item = itemSchema.parse({
        id: `item-life-${title.length}`,
        medium: "book",
        title,
        subtitle: "A life in markets, business, and strategy",
        creators: ["Walter Isaacson"],
        ref: { medium: "book", openLibraryId: title },
      });
      expect(classifyGenre(item).assignment.genre, title).toBe("lives");
    }
    expect(
      decisionForTitle("Beyond Basketball: Coach K's Keywords for Success")
        .assignment.genre,
    ).toBe("mind-mastery");
  });

  it("matches all 30 uniquely named films in the real TASTE baseline", () => {
    expect(TASTE_FILMS).toHaveLength(30);
    for (const [index, [title, expected]] of TASTE_FILMS.entries()) {
      const item = itemSchema.parse({
        id: `item-film-${title.toLowerCase().replace(/\W+/g, "-")}`,
        medium: "movie",
        title,
        creators: [],
        ref: { medium: "movie", tmdbId: index + 1 },
      });
      expect(classifyGenre(item).assignment.genre, title).toBe(expected);
    }
  });

  it("gives documented film title anchors precedence over misleading generic metadata", () => {
    for (const [title, description, expected] of [
      ["Knives Out", "A warm family business comedy", "crime-tension"],
      ["The Social Network", "A romantic murder mystery", "ambition-institutions"],
      ["Mean Girls", "A founder investigates a crime", "comfort-rewatch"],
    ] as const) {
      const item = itemSchema.parse({
        id: `item-film-precedence-${title.length}`,
        medium: "movie",
        title,
        creators: [],
        description,
        ref: { medium: "movie", tmdbId: title.length },
      });
      expect(classifyGenre(item).assignment.genre, title).toBe(expected);
    }
  });

  it("maps podcasts conservatively onto screen ladders until a user seed exists", () => {
    for (const [title, description, expected] of [
      ["Case Notes", "A murder investigation", "crime-tension"],
      ["Acquired", "Founders build a business empire", "ambition-institutions"],
      ["Family Favorites", "A warm family comedy", "comfort-rewatch"],
      ["Unseeded Show", undefined, "auteur-prestige"],
    ] as const) {
      const item = itemSchema.parse({
        id: `item-podcast-${title.length}`,
        medium: "podcast",
        title,
        creators: [],
        ...(description ? { description } : {}),
        ref: { medium: "podcast", appleId: title.length },
      });
      expect(classifyGenre(item).assignment.genre, title).toBe(expected);
    }
  });
});

describe("automatic assignment persistence", () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  afterAll(() => db.close());

  it("reclassifies auto records but never clobbers a manual override", async () => {
    const seed = {
      medium: "book",
      title: "Bad Blood",
      creators: ["John Carreyrou"],
      ref: { medium: "book", openLibraryId: "OL-test" },
    } satisfies ItemSeed;
    const item = await addItem(seed);
    expect((await applyAutoGenre(item)).genre).toEqual({
      genre: "money-markets",
      source: "auto",
    });

    const manuallyAssigned = await setItemGenre(item.id, {
      genre: "lives",
      source: "manual",
    });
    const reimportedMetadata = {
      ...manuallyAssigned,
      title: "Blue Ocean Strategy",
    } satisfies Item;
    expect(await applyAutoGenre(reimportedMetadata)).toEqual(manuallyAssigned);
    expect((await getItem(item.id))?.genre).toEqual({
      genre: "lives",
      source: "manual",
    });
  });
});
