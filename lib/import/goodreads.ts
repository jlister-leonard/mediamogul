import {
  entryIdSchema,
  entrySchema,
  goodreadsManualMatchSchema,
  itemIdSchema,
  itemSchema,
  queueItemIdSchema,
  queueItemSchema,
  type Entry,
  type Gradient,
  type GoodreadsManualMatch,
  type GoodreadsManualMatchReason as ManualMatchReason,
  type Item,
  type QueueItem,
  type RatingMode,
} from "../types";
import {
  getBooksProvider,
  isbn10To13,
  type BookQueryInput,
  type BookSeed,
  type BooksProvider,
  type BooksResult,
} from "../providers/books";
import {
  resolveManualMatch,
  restoreSnapshotIfEmpty,
  type RepoSnapshot,
} from "../db/repo/snapshot";
import { classifyGenre } from "../genre/classify";

const REQUIRED_HEADERS = [
  "Book Id",
  "Title",
  "Author",
  "Additional Authors",
  "ISBN",
  "ISBN13",
  "My Rating",
  "Number of Pages",
  "Year Published",
  "Original Publication Year",
  "Date Read",
  "Date Added",
  "Bookshelves",
  "Bookshelves with positions",
  "Exclusive Shelf",
  "My Review",
  "Private Notes",
  "Read Count",
] as const;

export interface ParsedGoodreadsRow {
  /** One-based source line, including the header as line 1. */
  rowNumber: number;
  bookId: string;
  title: string;
  authors: readonly string[];
  isbn10?: string;
  isbn13?: string;
  /** Non-empty malformed source values remain visible for manual correction. */
  invalidIsbns: readonly string[];
  rating?: 1 | 2 | 3 | 4 | 5;
  pages?: number;
  yearPublished?: number;
  originalPublicationYear?: number;
  dateRead?: string;
  dateAdded: string;
  shelves: readonly string[];
  shelfPositions: Readonly<Record<string, number>>;
  exclusiveShelf: string;
  review?: string;
  privateNotes?: string;
  readCount: number;
}

export type { GoodreadsManualMatch, ManualMatchReason };

export interface GoodreadsResolvedRow {
  source: ParsedGoodreadsRow;
  item: Item;
  entry?: Entry;
  queueItem?: QueueItem;
}

export interface GoodreadsImportStats {
  sourceRows: number;
  resolvedRows: number;
  manualMatchRows: number;
  validIsbn13Rows: number;
  validIsbn13ResolvedWithCover: number;
  isbn13CoverResolutionRate: number;
}

export interface GoodreadsImportPlan {
  rows: readonly ParsedGoodreadsRow[];
  resolved: readonly GoodreadsResolvedRow[];
  manualMatches: readonly GoodreadsManualMatch[];
  snapshot: Pick<RepoSnapshot, "items" | "entries" | "queue" | "manualMatches">;
  stats: GoodreadsImportStats;
}

export type GoodreadsBookLookup = (
  query: BookQueryInput,
) => Promise<BooksResult>;

/**
 * E1.4 always searches the E2.6 union: an honest empty response from one
 * catalog must not prevent the other catalog from resolving the row.
 */
export function createGoodreadsBookLookup(
  provider: Pick<BooksProvider, "search"> = getBooksProvider(),
): GoodreadsBookLookup {
  return (query) => provider.search(query, { mode: "union" });
}

type IdKind = "item" | "entry" | "queue";

export interface GoodreadsImportOptions {
  lookup?: GoodreadsBookLookup;
  /** Bounded fan-out avoids turning 225 rows into a serial multi-minute import. */
  concurrency?: number;
  /** Injectable for deterministic tests; production ids remain on-device UUIDs. */
  createId?: (kind: IdKind, row: ParsedGoodreadsRow) => string;
}

export interface ApplyGoodreadsImportOptions extends GoodreadsImportOptions {
  restore?: (
    snapshot: Pick<RepoSnapshot, "items" | "entries" | "queue" | "manualMatches">,
  ) => Promise<void>;
}

export interface ApplyGoodreadsManualMatchOptions {
  createId?: (kind: IdKind, row: ParsedGoodreadsRow) => string;
  resolve?: (
    matchId: string,
    snapshot: Pick<RepoSnapshot, "items" | "entries" | "queue">,
  ) => Promise<void>;
}

/**
 * Parse RFC-4180 CSV, including commas, escaped quotes and embedded newlines.
 * Goodreads' Excel-safe ISBN cells (`="978…"`) are unwrapped separately.
 */
export function parseGoodreadsCsv(csv: string): ParsedGoodreadsRow[] {
  const records = parseCsvRecords(csv);
  if (records.length === 0) throw new Error("Goodreads CSV is empty");
  const [headers, ...body] = records;
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  for (const required of REQUIRED_HEADERS) {
    if (!headerIndex.has(required)) {
      throw new Error(`Goodreads CSV is missing required column: ${required}`);
    }
  }

  const seenBookIds = new Set<string>();
  return body.map((cells, index) => {
    const rowNumber = index + 2;
    if (cells.length !== headers.length) {
      throw new Error(
        `Goodreads CSV row ${rowNumber} has ${cells.length} columns; expected ${headers.length}`,
      );
    }
    const value = (name: (typeof REQUIRED_HEADERS)[number]): string =>
      cells[headerIndex.get(name)!].trim();
    const required = (name: (typeof REQUIRED_HEADERS)[number]): string => {
      const result = value(name);
      if (result === "") {
        throw new Error(`Goodreads CSV row ${rowNumber} has no ${name}`);
      }
      return result;
    };

    const bookId = required("Book Id");
    if (seenBookIds.has(bookId)) {
      throw new Error(`Goodreads CSV row ${rowNumber} repeats Book Id ${bookId}`);
    }
    seenBookIds.add(bookId);

    const author = required("Author");
    const additionalAuthors = splitList(value("Additional Authors"));
    const authors = dedupe([author, ...additionalAuthors]);
    const rawIsbn10 = unwrapGoodreadsFormula(value("ISBN"));
    const rawIsbn13 = unwrapGoodreadsFormula(value("ISBN13"));
    const isbn10 = validIsbn10(rawIsbn10) ? rawIsbn10.toUpperCase() : undefined;
    const directIsbn13 = validIsbn13(rawIsbn13) ? rawIsbn13 : undefined;
    const isbn13 = directIsbn13 ?? (isbn10 ? isbn10To13(isbn10) : undefined);
    const invalidIsbns = [
      ...(rawIsbn10 !== "" && isbn10 === undefined ? [rawIsbn10] : []),
      ...(rawIsbn13 !== "" && directIsbn13 === undefined ? [rawIsbn13] : []),
    ];
    const ratingValue = parseInteger(value("My Rating"), "My Rating", rowNumber, {
      min: 0,
      max: 5,
    });
    const rating = ratingValue === 0 ? undefined : (ratingValue as 1 | 2 | 3 | 4 | 5);
    const shelves = splitList(value("Bookshelves"));

    return {
      rowNumber,
      bookId,
      title: required("Title"),
      authors,
      ...(isbn10 !== undefined && { isbn10 }),
      ...(isbn13 !== undefined && { isbn13 }),
      invalidIsbns,
      ...(rating !== undefined && { rating }),
      ...optionalIntegerField(value("Number of Pages"), "pages", rowNumber, {
        min: 1,
        zeroIsMissing: true,
      }),
      ...optionalIntegerField(value("Year Published"), "yearPublished", rowNumber, {
        min: 1,
      }),
      ...optionalIntegerField(
        value("Original Publication Year"),
        "originalPublicationYear",
        rowNumber,
        {},
      ),
      ...optionalDateField(value("Date Read"), "dateRead", rowNumber),
      dateAdded: parseDate(value("Date Added"), "Date Added", rowNumber),
      shelves,
      shelfPositions: parseShelfPositions(value("Bookshelves with positions"), rowNumber),
      exclusiveShelf: required("Exclusive Shelf"),
      ...optionalTextField(value("My Review"), "review"),
      ...optionalTextField(value("Private Notes"), "privateNotes"),
      readCount: parseInteger(value("Read Count"), "Read Count", rowNumber, {
        min: 0,
      }),
    };
  });
}

/** Build a complete, side-effect-free import plan. Every source row is accounted for. */
export async function prepareGoodreadsImport(
  csv: string,
  options: GoodreadsImportOptions = {},
): Promise<GoodreadsImportPlan> {
  const rows = parseGoodreadsCsv(csv);
  const lookup = options.lookup ?? createGoodreadsBookLookup();
  const createId =
    options.createId ?? (() => globalThis.crypto.randomUUID());
  const concurrency = options.concurrency ?? 8;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error("Goodreads import concurrency must be an integer from 1 to 32");
  }

  const outcomes = await mapWithConcurrency(rows, concurrency, (row) =>
    resolveRow(row, lookup, createId),
  );
  const resolved = outcomes.filter(
    (outcome): outcome is GoodreadsResolvedRow => "item" in outcome,
  );
  const manualMatches = outcomes.filter(
    (outcome): outcome is GoodreadsManualMatch => "reason" in outcome,
  );
  if (resolved.length + manualMatches.length !== rows.length) {
    throw new Error("Goodreads import accounting invariant failed");
  }

  const validIsbn13Rows = rows.filter((row) => row.isbn13 !== undefined).length;
  const validIsbn13ResolvedWithCover = resolved.filter(
    ({ source, item }) => source.isbn13 !== undefined && item.artUrl !== undefined,
  ).length;
  const stats: GoodreadsImportStats = {
    sourceRows: rows.length,
    resolvedRows: resolved.length,
    manualMatchRows: manualMatches.length,
    validIsbn13Rows,
    validIsbn13ResolvedWithCover,
    isbn13CoverResolutionRate:
      validIsbn13Rows === 0
        ? 1
        : validIsbn13ResolvedWithCover / validIsbn13Rows,
  };

  return {
    rows,
    resolved,
    manualMatches,
    snapshot: {
      items: resolved.map(({ item }) => item),
      entries: resolved.flatMap(({ entry }) => (entry ? [entry] : [])),
      queue: resolved.flatMap(({ queueItem }) => (queueItem ? [queueItem] : [])),
      manualMatches,
    },
    stats,
  };
}

/** Apply resolved records atomically to a fresh install and return manual work to the caller. */
export async function importGoodreadsCsv(
  csv: string,
  options: ApplyGoodreadsImportOptions = {},
): Promise<GoodreadsImportPlan> {
  const { restore = restoreSnapshotIfEmpty, ...prepareOptions } = options;
  const plan = await prepareGoodreadsImport(csv, prepareOptions);
  if (plan.rows.length > 0) await restore(plan.snapshot);
  return plan;
}

/**
 * Complete one manual match after the user selects a catalog result. The
 * chosen canonical item and its historical entry/stack row land atomically.
 */
export async function applyGoodreadsManualMatch(
  match: GoodreadsManualMatch,
  chosenSeed: BookSeed,
  options: ApplyGoodreadsManualMatchOptions = {},
): Promise<GoodreadsResolvedRow> {
  if (chosenSeed.artUrl === undefined) {
    throw new Error("A Goodreads manual match needs canonical cover art");
  }
  const createId =
    options.createId ?? (() => globalThis.crypto.randomUUID());
  const resolved = materialize(match.source, chosenSeed, createId);
  const snapshot = {
    items: [resolved.item],
    entries: resolved.entry ? [resolved.entry] : [],
    queue: resolved.queueItem ? [resolved.queueItem] : [],
  };
  await (options.resolve ?? resolveManualMatch)(match.id, snapshot);
  return resolved;
}

async function resolveRow(
  row: ParsedGoodreadsRow,
  lookup: GoodreadsBookLookup,
  createId: (kind: IdKind, row: ParsedGoodreadsRow) => string,
): Promise<GoodreadsResolvedRow | GoodreadsManualMatch> {
  const isbnQuery: BookQueryInput | undefined = row.isbn13
    ? { isbn: row.isbn13, limit: 1 }
    : undefined;
  const titleQuery: BookQueryInput = {
    title: row.title,
    author: row.authors[0],
    limit: 10,
  };
  const attempts: Array<{ query: BookQueryInput; result: BooksResult }> = [];

  for (const query of isbnQuery ? [isbnQuery, titleQuery] : [titleQuery]) {
    let result: BooksResult;
    try {
      result = await lookup(query);
    } catch (error) {
      result = {
        ok: false,
        error: {
          code: "upstream_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    attempts.push({ query, result });
    if (!result.ok) continue;
    const selection = selectCandidate(row, result.seeds, query === isbnQuery);
    if (selection.kind === "selected") {
      return materialize(row, selection.seed, createId);
    }
    if (selection.kind === "ambiguous") {
      return manual(row, "ambiguous-match", selection.detail, query);
    }
    if (selection.kind === "missing-cover") {
      // A title fallback may find a different provider record with artwork.
      if (query === isbnQuery) continue;
      return manual(row, "missing-cover", selection.detail, query);
    }
  }

  const last = attempts.at(-1)!;
  const failures = attempts.filter(({ result }) => !result.ok);
  if (failures.length === attempts.length) {
    return manual(
      row,
      "provider-error",
      failures
        .map(({ result }) => (result.ok ? "" : result.error.message))
        .join("; "),
      last.query,
    );
  }
  const hadCoverless = attempts.some(
    ({ result }) => result.ok && result.seeds.some((seed) => seed.artUrl === undefined),
  );
  return manual(
    row,
    hadCoverless ? "missing-cover" : "no-match",
    hadCoverless
      ? "Catalog candidates were found, but none had cover art"
      : "No confident catalog match was found",
    last.query,
  );
}

type CandidateSelection =
  | { kind: "selected"; seed: BookSeed }
  | { kind: "ambiguous" | "missing-cover" | "none"; detail: string };

function selectCandidate(
  row: ParsedGoodreadsRow,
  seeds: readonly BookSeed[],
  isbnLookup: boolean,
): CandidateSelection {
  const candidates = isbnLookup
    ? seeds.filter((seed) =>
        seed.ref.isbn13 === row.isbn13 ||
        (seed.ref.isbn13 === undefined && sameBook(row, seed)),
      )
    : seeds.filter((seed) => sameBook(row, seed));
  if (candidates.length === 0) {
    return { kind: "none", detail: "No confident catalog match was found" };
  }
  const withCover = candidates.filter((seed) => seed.artUrl !== undefined);
  if (withCover.length === 1) return { kind: "selected", seed: withCover[0] };
  if (withCover.length > 1) {
    return {
      kind: "ambiguous",
      detail: `${withCover.length} equally plausible catalog matches need confirmation`,
    };
  }
  return {
    kind: "missing-cover",
    detail: "The catalog match has no cover art",
  };
}

function sameBook(row: ParsedGoodreadsRow, seed: BookSeed): boolean {
  const sourceTitle = normalizeTitle(row.title);
  const sourceShortTitle = normalizeTitle(row.title.split(":")[0]);
  const candidateTitle = normalizeTitle(
    seed.subtitle ? `${seed.title}: ${seed.subtitle}` : seed.title,
  );
  const shortCandidate = normalizeTitle(seed.title);
  const titleMatches =
    candidateTitle === sourceTitle ||
    shortCandidate === sourceShortTitle;
  const sourceAuthors = new Set(row.authors.map(normalizeName));
  const authorMatches = seed.creators.some((creator) =>
    sourceAuthors.has(normalizeName(creator)),
  );
  return titleMatches && authorMatches;
}

function materialize(
  row: ParsedGoodreadsRow,
  seed: BookSeed,
  createId: (kind: IdKind, row: ParsedGoodreadsRow) => string,
): GoodreadsResolvedRow {
  const itemId = itemIdSchema.parse(createId("item", row));
  const creators = seed.creators.length > 0 ? seed.creators : [...row.authors];
  const candidate = {
    ...seed,
    id: itemId,
    creators,
    ref: {
      ...seed.ref,
      ...(row.isbn13 !== undefined && { isbn13: row.isbn13 }),
    },
    ...(seed.pages === undefined && row.pages !== undefined && { pages: row.pages }),
    ...(seed.year === undefined && {
      ...(row.originalPublicationYear !== undefined
        ? { year: row.originalPublicationYear }
        : row.yearPublished !== undefined
          ? { year: row.yearPublished }
          : {}),
    }),
  };
  const item = itemSchema.parse({
    ...candidate,
    genre: classifyGenre(candidate).assignment,
  });
  const entry = makeEntry(row, itemId, createId);
  const queueItem = makeQueueItem(row, itemId, createId);
  return {
    source: row,
    item,
    ...(entry !== undefined && { entry }),
    ...(queueItem !== undefined && { queueItem }),
  };
}

function makeEntry(
  row: ParsedGoodreadsRow,
  itemId: ReturnType<typeof itemIdSchema.parse>,
  createId: (kind: IdKind, row: ParsedGoodreadsRow) => string,
): Entry | undefined {
  const inProgress = row.exclusiveShelf === "currently-reading";
  const finished =
    !inProgress &&
    (row.exclusiveShelf === "read" ||
      row.readCount > 0 ||
      row.rating !== undefined ||
      row.dateRead !== undefined);
  if (!inProgress && !finished) return undefined;
  const note = [row.review, row.privateNotes].filter(Boolean).join("\n\n") || undefined;
  return entrySchema.parse({
    id: entryIdSchema.parse(createId("entry", row)),
    itemId,
    status: inProgress ? "in-progress" : "finished",
    ...(!inProgress && row.dateRead !== undefined && { finishedAt: row.dateRead }),
    ...(row.rating !== undefined && {
      gradient: gradientFromRating(row.rating),
      mode: modeFromRow(row),
    }),
    tags: row.shelves.map((shelf) => `goodreads:shelf:${shelf}`),
    ...(note !== undefined && { note }),
  });
}

function makeQueueItem(
  row: ParsedGoodreadsRow,
  itemId: ReturnType<typeof itemIdSchema.parse>,
  createId: (kind: IdKind, row: ParsedGoodreadsRow) => string,
): QueueItem | undefined {
  if (row.exclusiveShelf !== "to-read" && row.exclusiveShelf !== "learning-plan") {
    return undefined;
  }
  return queueItemSchema.parse({
    id: queueItemIdSchema.parse(createId("queue", row)),
    itemId,
    contextTags: row.shelves.map((shelf) => `goodreads:shelf:${shelf}`),
    addedReason: `Imported from Goodreads ${row.exclusiveShelf}`,
    addedAt: row.dateAdded,
  });
}

export function modeFromRow(row: Pick<ParsedGoodreadsRow, "title" | "authors" | "rating">): RatingMode {
  if (row.rating === 5 && isNostalgiaCluster(row.title, row.authors)) return "comfort";
  return row.rating === 5 ? "admired" : "enjoyed";
}

export function isNostalgiaCluster(title: string, authors: readonly string[]): boolean {
  const foldedTitle = normalizeTitle(title);
  const foldedAuthors = authors.map(normalizeName);
  return (
    (foldedAuthors.includes("anthony horowitz") && foldedTitle.includes("alex rider")) ||
    (foldedAuthors.includes("jk rowling") && foldedTitle.startsWith("harry potter")) ||
    foldedAuthors.includes("dr seuss") ||
    foldedTitle === "samurai shortstop"
  );
}

function gradientFromRating(rating: 1 | 2 | 3 | 4 | 5): Gradient {
  if (rating === 5) return "loved";
  if (rating === 4) return "liked";
  if (rating === 3) return "fine";
  return "no";
}

function manual(
  source: ParsedGoodreadsRow,
  reason: ManualMatchReason,
  detail: string,
  suggestedQuery: BookQueryInput,
): GoodreadsManualMatch {
  return goodreadsManualMatchSchema.parse({
    id: `goodreads:${source.bookId}`,
    source,
    reason,
    detail,
    suggestedQuery,
  });
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await map(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return output;
}

function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let state: "start" | "unquoted" | "quoted" | "after-quote" = "start";
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (state === "quoted") {
      if (char === '"' && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        state = "after-quote";
      } else {
        cell += char;
      }
    } else if (state === "after-quote") {
      if (char === ",") {
        record.push(cell);
        cell = "";
        state = "start";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && csv[index + 1] === "\n") index += 1;
        record.push(cell);
        if (record.some((value) => value !== "")) records.push(record);
        record = [];
        cell = "";
        state = "start";
      } else {
        throw new Error(
          `Goodreads CSV has unexpected character after a closing quote at offset ${index}`,
        );
      }
    } else if (char === '"') {
      if (state !== "start") {
        throw new Error(`Goodreads CSV has a quote inside an unquoted field at offset ${index}`);
      }
      state = "quoted";
    } else if (char === ",") {
      record.push(cell);
      cell = "";
      state = "start";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      record.push(cell);
      if (record.some((value) => value !== "")) records.push(record);
      record = [];
      cell = "";
      state = "start";
    } else {
      cell += char;
      state = "unquoted";
    }
  }
  if (state === "quoted") throw new Error("Goodreads CSV has an unterminated quoted field");
  record.push(cell);
  if (record.some((value) => value !== "")) records.push(record);
  return records;
}

function unwrapGoodreadsFormula(value: string): string {
  const match = value.match(/^="(.*)"$/);
  return (match?.[1] ?? value).replace(/[-\s]/g, "");
}

function validIsbn10(value: string): boolean {
  return value !== "" && isbn10To13(value.toUpperCase()) !== undefined;
}

function validIsbn13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(value[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

function splitList(value: string): string[] {
  return dedupe(value.split(",").map((part) => part.trim()).filter(Boolean));
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseInteger(
  value: string,
  field: string,
  rowNumber: number,
  bounds: { min?: number; max?: number } = {},
): number {
  const number = Number(value);
  if (
    value === "" ||
    !Number.isInteger(number) ||
    (bounds.min !== undefined && number < bounds.min) ||
    (bounds.max !== undefined && number > bounds.max)
  ) {
    throw new Error(`Goodreads CSV row ${rowNumber} has invalid ${field}: ${value}`);
  }
  return number;
}

function optionalIntegerField<K extends string>(
  value: string,
  key: K,
  rowNumber: number,
  options: { min?: number; zeroIsMissing?: boolean },
): { [P in K]?: number } {
  return value === "" || (options.zeroIsMissing && value === "0")
    ? {}
    : ({ [key]: parseInteger(value, key, rowNumber, { min: options.min }) } as {
        [P in K]?: number;
      });
}

function optionalDateField<K extends string>(
  value: string,
  key: K,
  rowNumber: number,
): { [P in K]?: string } {
  return value === ""
    ? {}
    : ({ [key]: parseDate(value, key, rowNumber) } as { [P in K]?: string });
}

function optionalTextField<K extends string>(
  value: string,
  key: K,
): { [P in K]?: string } {
  return value === "" ? {} : ({ [key]: value } as { [P in K]?: string });
}

function parseDate(value: string, field: string, rowNumber: number): string {
  const match = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!match) {
    throw new Error(`Goodreads CSV row ${rowNumber} has invalid ${field}: ${value}`);
  }
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new Error(`Goodreads CSV row ${rowNumber} has invalid ${field}: ${value}`);
  }
  return date.toISOString();
}

function parseShelfPositions(value: string, rowNumber: number): Record<string, number> {
  if (value === "") return {};
  return Object.fromEntries(
    splitList(value).map((part) => {
      const match = part.match(/^(.+) \(#(\d+)\)$/);
      if (!match) {
        throw new Error(
          `Goodreads CSV row ${rowNumber} has invalid shelf position: ${part}`,
        );
      }
      return [match[1], Number(match[2])];
    }),
  );
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-zA-Z0-9']+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function normalizeName(value: string): string {
  return normalizeTitle(value.replace(/\./g, ""));
}
