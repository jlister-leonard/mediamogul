import { z } from "zod";
import { itemSeedSchema, type ItemSeed } from "../types";

/**
 * E2.1 provider-books — book metadata search, Open Library primary with
 * Google Books fallback. Both are keyless for basic search, so this module
 * holds no secrets. Everything upstream is Zod-parsed into explicit
 * upstream-shape schemas before mapping; nothing downstream of this file
 * ever touches a raw provider payload (lib/types/media.ts contract).
 *
 * The route handler in `app/api/providers/books/route.ts` is a thin shell
 * over `getBooksProvider().search()`.
 */

/** A provider-normalized book search result — an `ItemSeed` narrowed to books. */
export type BookSeed = Extract<ItemSeed, { medium: "book" }>;

const bookSeedSchema = itemSeedSchema.refine(
  (seed): seed is BookSeed => seed.medium === "book",
  { message: "books provider seeds must have medium 'book'" },
);

// ---------------------------------------------------------------------------
// Result envelope — what the route returns and what E2.4's resolver consumes.
// Failures are always this typed shape, never a thrown error or an HTML 500.
// ---------------------------------------------------------------------------

export const bookSourceSchema = z.enum(["openlibrary", "googlebooks"]);
export type BookSource = z.infer<typeof bookSourceSchema>;

export const booksErrorCodeSchema = z.enum([
  /** The request itself was invalid (missing query, malformed ISBN). */
  "bad_request",
  /** Every upstream was down, unreachable, rate-limited, or timed out. */
  "upstream_unavailable",
  /** Every upstream answered, but with payloads that failed schema parsing. */
  "upstream_malformed",
]);
export type BooksErrorCode = z.infer<typeof booksErrorCodeSchema>;

export const booksErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: booksErrorCodeSchema,
    message: z.string().min(1),
    /** Per-upstream failure detail, present when upstreams were attempted. */
    upstream: z
      .array(
        z.object({ source: bookSourceSchema, reason: z.string().min(1) }),
      )
      .optional(),
  }),
});
export type BooksError = z.infer<typeof booksErrorSchema>;

export const booksSuccessSchema = z.object({
  ok: z.literal(true),
  /** Which upstream actually answered — primary or fallback. */
  source: bookSourceSchema,
  seeds: z.array(bookSeedSchema),
});
export type BooksSuccess = z.infer<typeof booksSuccessSchema>;

export const booksResultSchema = z.discriminatedUnion("ok", [
  booksSuccessSchema,
  booksErrorSchema,
]);
export type BooksResult = z.infer<typeof booksResultSchema>;

// ---------------------------------------------------------------------------
// Query — free-text and/or fielded title/author search, or a bare ISBN-13
// lookup (E1.4's importer path: 0-or-1 seed). `isbn` wins when present.
// ---------------------------------------------------------------------------

/**
 * Deterministic ISBN-10 → ISBN-13 conversion: verify the ISBN-10 check
 * digit (weights 10…1 mod 11, "X" = 10), then prefix 978 and recompute the
 * EAN-13 check digit. Returns undefined for a failed checksum — E1.4's CSV
 * carries ISBN-10-only rows, and a silent bad conversion would corrupt
 * catalog identity.
 */
export function isbn10To13(isbn10: string): string | undefined {
  const normalized = isbn10.toUpperCase();
  if (!/^\d{9}[\dX]$/.test(normalized)) return undefined;
  let checksum = 0;
  for (let i = 0; i < 10; i += 1) {
    const digit = normalized[i] === "X" ? 10 : Number(normalized[i]);
    checksum += digit * (10 - i);
  }
  if (checksum % 11 !== 0) return undefined;
  const core = `978${normalized.slice(0, 9)}`;
  let ean = 0;
  for (let i = 0; i < 12; i += 1) {
    ean += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return core + String((10 - (ean % 10)) % 10);
}

export const bookQuerySchema = z
  .object({
    /** Free-text query, matched broadly by both upstreams. */
    q: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    author: z.string().trim().min(1).optional(),
    /**
     * ISBN-13 or ISBN-10; hyphens/spaces tolerated. An ISBN-10 is converted
     * to its ISBN-13 form (E1.4's CSV has ISBN-10-only rows). Takes
     * precedence over the text fields.
     */
    isbn: z
      .string()
      .trim()
      .transform((s) => s.replace(/[-\s]/g, "").toUpperCase())
      .pipe(
        z
          .string()
          .regex(
            /^(\d{13}|\d{9}[\dX])$/,
            "isbn must be an ISBN-13 (13 digits) or an ISBN-10",
          ),
      )
      .transform((s, ctx) => {
        if (/^\d{13}$/.test(s)) return s;
        const converted = isbn10To13(s);
        if (converted === undefined) {
          ctx.addIssue({
            code: "custom",
            message: "invalid ISBN-10 check digit",
          });
          return z.NEVER;
        }
        return converted;
      })
      .optional(),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .refine(
    (query) =>
      query.q !== undefined ||
      query.title !== undefined ||
      query.author !== undefined ||
      query.isbn !== undefined,
    { message: "provide at least one of: q, title, author, isbn" },
  );
export type BookQuery = z.infer<typeof bookQuerySchema>;
/** What callers may pass — `limit` optional, isbn hyphens not yet stripped. */
export type BookQueryInput = z.input<typeof bookQuerySchema>;

// ---------------------------------------------------------------------------
// Upstream shapes — minimal loose schemas for exactly the fields we map.
// A payload that fails these is a *malformed upstream*, a typed error, never
// an exception escaping into the route.
// ---------------------------------------------------------------------------

/** https://openlibrary.org/dev/docs/api/search — one work per doc. */
export const openLibraryDocSchema = z.looseObject({
  /** Work key, e.g. "/works/OL27448W". */
  key: z.string().min(1),
  title: z.string(),
  subtitle: z.string().optional(),
  author_name: z.array(z.string()).optional(),
  first_publish_year: z.number().int().optional(),
  /** Cover id for covers.openlibrary.org. */
  cover_i: z.number().int().optional(),
  number_of_pages_median: z.number().int().optional(),
  /** Star average plus the 1★→5★ distribution behind "this one splits people". */
  ratings_average: z.number().optional(),
  ratings_count: z.number().int().optional(),
  ratings_count_1: z.number().int().optional(),
  ratings_count_2: z.number().int().optional(),
  ratings_count_3: z.number().int().optional(),
  ratings_count_4: z.number().int().optional(),
  ratings_count_5: z.number().int().optional(),
});
export type OpenLibraryDoc = z.infer<typeof openLibraryDocSchema>;

/**
 * Only the envelope is load-bearing; `docs` stay unknown so one malformed
 * doc drops that doc alone (per-doc safeParse in `searchOpenLibrary`), not
 * the whole response.
 */
export const openLibrarySearchSchema = z.looseObject({
  numFound: z.number().int().nonnegative(),
  docs: z.array(z.unknown()),
});

/** https://developers.google.com/books/docs/v1/reference/volumes */
const googleImageLinksSchema = z.looseObject({
  smallThumbnail: z.string().optional(),
  thumbnail: z.string().optional(),
  small: z.string().optional(),
  medium: z.string().optional(),
  large: z.string().optional(),
  extraLarge: z.string().optional(),
});
type GoogleImageLinks = z.infer<typeof googleImageLinksSchema>;

export const googleVolumeSchema = z.looseObject({
  id: z.string().min(1),
  volumeInfo: z
    .looseObject({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      authors: z.array(z.string()).optional(),
      /** "2017", "2017-05", or "2017-05-23". */
      publishedDate: z.string().optional(),
      description: z.string().optional(),
      industryIdentifiers: z
        .array(
          z.looseObject({ type: z.string(), identifier: z.string() }),
        )
        .optional(),
      pageCount: z.number().int().optional(),
      averageRating: z.number().optional(),
      ratingsCount: z.number().int().optional(),
      imageLinks: googleImageLinksSchema.optional(),
    })
    .optional(),
});
export type GoogleVolume = z.infer<typeof googleVolumeSchema>;

export const googleVolumesSchema = z.looseObject({
  totalItems: z.number().int().nonnegative(),
  items: z.array(googleVolumeSchema).optional(),
});

// ---------------------------------------------------------------------------
// Normalization — the product. Short title, DEMOTED subtitle (PLAN §2),
// cleaned creators, largest-available art, and a BookRef with every id we
// can extract.
// ---------------------------------------------------------------------------

/**
 * PLAN §2: "Short title, demoted subtitle." When the source gives a separate
 * subtitle we keep the split; when the whole subtitle is jammed into the
 * title ("Debt: The First 5,000 Years") we split at the first colon.
 * Guards: a purely numeric head ("2001: A Space Odyssey") or a head shorter
 * than two non-space characters ("V: The Original Miniseries") is a real
 * title, not a title+subtitle, so it is never split. Title and subtitle are
 * never re-concatenated anywhere downstream.
 */
export function demoteSubtitle(
  rawTitle: string,
  rawSubtitle?: string,
): { title: string; subtitle?: string } {
  const title = collapseWhitespace(rawTitle);
  const subtitle = rawSubtitle ? collapseWhitespace(rawSubtitle) : "";
  if (subtitle !== "") return { title, subtitle };

  const colonAt = title.indexOf(":");
  if (colonAt > 0) {
    const head = title.slice(0, colonAt).trim();
    const tail = title.slice(colonAt + 1).trim();
    if (
      head.replace(/\s/g, "").length >= 2 &&
      tail !== "" &&
      !/^\d+$/.test(head)
    ) {
      return { title: head, subtitle: tail };
    }
  }
  return { title };
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Trim, drop empties, dedupe case-insensitively keeping first spelling. */
function cleanAuthors(names: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names ?? []) {
    const name = collapseWhitespace(raw);
    const fold = name.toLowerCase();
    if (name === "" || seen.has(fold)) continue;
    seen.add(fold);
    out.push(name);
  }
  return out;
}

function firstIsbn13(
  candidates: readonly string[] | undefined,
): string | undefined {
  return candidates?.map((c) => c.replace(/[-\s]/g, "")).find((c) =>
    /^\d{13}$/.test(c),
  );
}

/**
 * A seed candidate is only kept if it round-trips the shared contract —
 * upstream junk (empty title, unusable ids) is dropped per-doc instead of
 * failing the whole response.
 */
function toValidSeed(candidate: unknown): BookSeed | undefined {
  const parsed = bookSeedSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Note on ISBNs: an Open Library work doc's `isbn` field is an unordered
 * list across *all* editions, so no entry can be trusted as "the" ISBN of
 * this seed — text-search seeds carry only the work id, and the ISBN-lookup
 * path stamps the queried ISBN in `pickIsbnSeed`. Catalog identity (E2.4
 * dedupe, Get-it links) must never rest on an arbitrary edition.
 */
function normalizeOpenLibraryDoc(doc: OpenLibraryDoc): BookSeed | undefined {
  const { title, subtitle } = demoteSubtitle(doc.title, doc.subtitle);
  const histogram =
    doc.ratings_count_1 !== undefined &&
    doc.ratings_count_2 !== undefined &&
    doc.ratings_count_3 !== undefined &&
    doc.ratings_count_4 !== undefined &&
    doc.ratings_count_5 !== undefined
      ? ([
          doc.ratings_count_1,
          doc.ratings_count_2,
          doc.ratings_count_3,
          doc.ratings_count_4,
          doc.ratings_count_5,
        ] as const)
      : undefined;

  return toValidSeed({
    medium: "book",
    ref: {
      medium: "book",
      // "/works/OL27448W" → "OL27448W"; bare work id is the canonical form.
      openLibraryId: doc.key.replace(/^\/works\//, ""),
    },
    title,
    ...(subtitle !== undefined && { subtitle }),
    creators: cleanAuthors(doc.author_name),
    ...(doc.first_publish_year !== undefined && {
      year: doc.first_publish_year,
    }),
    ...(doc.cover_i !== undefined && {
      // "-L" is Open Library's largest rendition.
      artUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
    }),
    ...(doc.number_of_pages_median !== undefined &&
      doc.number_of_pages_median > 0 && { pages: doc.number_of_pages_median }),
    ...(doc.ratings_average !== undefined &&
      doc.ratings_count !== undefined && {
        communityRating: {
          average: doc.ratings_average,
          count: doc.ratings_count,
          ...(histogram !== undefined && { histogram }),
        },
      }),
  });
}

/**
 * Largest rendition Google offers, upgraded to https. List responses in
 * practice carry only smallThumbnail/thumbnail (the larger renditions
 * appear on single-volume GETs), so `zoom=1` thumbnail URLs are rewritten
 * to `zoom=3` — the same asset at detail-page size instead of a postage
 * stamp (PLAN §3: art is the hero).
 */
function largestGoogleCover(
  links: GoogleImageLinks | undefined,
): string | undefined {
  const url =
    links?.extraLarge ??
    links?.large ??
    links?.medium ??
    links?.small ??
    links?.thumbnail ??
    links?.smallThumbnail;
  return url
    ?.replace(/^http:\/\//, "https://")
    .replace(/([?&])zoom=1(?=&|$)/, "$1zoom=3");
}

function yearFromPublishedDate(date: string | undefined): number | undefined {
  const match = date?.match(/^(\d{4})/);
  return match ? Number(match[1]) : undefined;
}

function normalizeGoogleVolume(volume: GoogleVolume): BookSeed | undefined {
  const info = volume.volumeInfo;
  if (info?.title === undefined) return undefined;
  const { title, subtitle } = demoteSubtitle(info.title, info.subtitle);
  const isbn13 = firstIsbn13(
    info.industryIdentifiers
      ?.filter((id) => id.type === "ISBN_13")
      .map((id) => id.identifier),
  );
  const artUrl = largestGoogleCover(info.imageLinks);
  const year = yearFromPublishedDate(info.publishedDate);
  const description = info.description?.trim();

  return toValidSeed({
    medium: "book",
    ref: {
      medium: "book",
      ...(isbn13 !== undefined && { isbn13 }),
      googleBooksId: volume.id,
    },
    title,
    ...(subtitle !== undefined && { subtitle }),
    creators: cleanAuthors(info.authors),
    ...(year !== undefined && { year }),
    ...(artUrl !== undefined && { artUrl }),
    ...(info.pageCount !== undefined &&
      info.pageCount > 0 && { pages: info.pageCount }),
    ...(description !== undefined &&
      description !== "" && { description }),
    ...(info.averageRating !== undefined &&
      info.ratingsCount !== undefined && {
        communityRating: {
          average: info.averageRating,
          count: info.ratingsCount,
        },
      }),
  });
}

/**
 * For an ISBN lookup the contract is 0-or-1 seed (E1.4 importer). Prefer the
 * seed whose ref carries the queried ISBN; otherwise trust the upstream's
 * first match.
 */
function pickIsbnSeed(seeds: readonly BookSeed[], isbn: string): BookSeed[] {
  const exact = seeds.find((seed) => seed.ref.isbn13 === isbn);
  const chosen = exact ?? seeds[0];
  if (chosen === undefined) return [];
  // The queried ISBN identifies this book even when the upstream doc omitted
  // or reordered its ISBN list — stamp it into the ref for the importer.
  return [{ ...chosen, ref: { ...chosen.ref, isbn13: isbn } }];
}

// ---------------------------------------------------------------------------
// Upstream calls
// ---------------------------------------------------------------------------

const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const GOOGLE_BOOKS_VOLUMES_URL = "https://www.googleapis.com/books/v1/volumes";

const OPEN_LIBRARY_FIELDS = [
  "key",
  "title",
  "subtitle",
  "author_name",
  "first_publish_year",
  "cover_i",
  "number_of_pages_median",
  "ratings_average",
  "ratings_count",
  "ratings_count_1",
  "ratings_count_2",
  "ratings_count_3",
  "ratings_count_4",
  "ratings_count_5",
].join(",");

export function openLibraryUrl(query: BookQuery): string {
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);
  url.searchParams.set("fields", OPEN_LIBRARY_FIELDS);
  url.searchParams.set("limit", String(query.isbn ? 1 : query.limit));
  if (query.isbn !== undefined) {
    url.searchParams.set("q", `isbn:${query.isbn}`);
  } else {
    if (query.q !== undefined) url.searchParams.set("q", query.q);
    if (query.title !== undefined) url.searchParams.set("title", query.title);
    if (query.author !== undefined) {
      url.searchParams.set("author", query.author);
    }
  }
  return url.toString();
}

export function googleBooksUrl(query: BookQuery): string {
  const url = new URL(GOOGLE_BOOKS_VOLUMES_URL);
  // Field values are wrapped in double quotes, so embedded quotes would
  // break out of the phrase — strip them.
  const phrase = (value: string): string => value.replace(/"/g, "").trim();
  const q =
    query.isbn !== undefined
      ? `isbn:${query.isbn}`
      : [
          query.q,
          query.title !== undefined
            ? `intitle:"${phrase(query.title)}"`
            : undefined,
          query.author !== undefined
            ? `inauthor:"${phrase(query.author)}"`
            : undefined,
        ]
          .filter((part): part is string => part !== undefined)
          .join(" ");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", String(query.isbn ? 1 : query.limit));
  url.searchParams.set("printType", "books");
  // Server-side callers from datacenter IPs get "cannot determine user
  // location" without an explicit country (region US, decision #8).
  url.searchParams.set("country", "US");
  return url.toString();
}

type UpstreamFailure = {
  source: BookSource;
  kind: "unavailable" | "malformed";
  reason: string;
};

type UpstreamOutcome =
  | { ok: true; seeds: BookSeed[] }
  | ({ ok: false } & UpstreamFailure);

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Provider — in-memory LRU over normalized results, primary→fallback logic.
// ---------------------------------------------------------------------------

export interface BooksProviderOptions {
  /** Injectable for tests; defaults to the ambient fetch at call time. */
  fetchFn?: typeof fetch;
  /** Injectable clock for TTL tests. */
  now?: () => number;
  cacheSize?: number;
  cacheTtlMs?: number;
  timeoutMs?: number;
}

export interface BooksProvider {
  search(query: BookQueryInput): Promise<BooksResult>;
}

class LruCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency: Map iteration order is insertion order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    if (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }
}

function cacheKey(query: BookQuery): string {
  const fold = (value: string | undefined): string | undefined =>
    value === undefined
      ? undefined
      : collapseWhitespace(value).toLowerCase();
  return JSON.stringify([
    fold(query.q),
    fold(query.title),
    fold(query.author),
    query.isbn,
    query.limit,
  ]);
}

export function createBooksProvider(
  options: BooksProviderOptions = {},
): BooksProvider {
  const fetchFn: typeof fetch =
    options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8000;
  const cache = new LruCache<BooksSuccess>(
    options.cacheSize ?? 500,
    options.cacheTtlMs ?? 60 * 60 * 1000,
    now,
  );

  async function fetchBody(
    source: BookSource,
    url: string,
  ): Promise<{ ok: true; body: unknown } | ({ ok: false } & UpstreamFailure)> {
    let response: Response;
    try {
      response = await fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
      });
    } catch (error) {
      return {
        ok: false,
        source,
        kind: "unavailable",
        reason: failureMessage(error),
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        source,
        kind: "unavailable",
        reason: `HTTP ${response.status}`,
      };
    }
    try {
      return { ok: true, body: (await response.json()) as unknown };
    } catch {
      return {
        ok: false,
        source,
        kind: "malformed",
        reason: "response body was not JSON",
      };
    }
  }

  async function searchOpenLibrary(query: BookQuery): Promise<UpstreamOutcome> {
    const fetched = await fetchBody("openlibrary", openLibraryUrl(query));
    if (!fetched.ok) return fetched;
    const parsed = openLibrarySearchSchema.safeParse(fetched.body);
    if (!parsed.success) {
      return {
        ok: false,
        source: "openlibrary",
        kind: "malformed",
        reason: "payload did not match the Open Library search shape",
      };
    }
    const seeds = parsed.data.docs
      .map((raw) => {
        const doc = openLibraryDocSchema.safeParse(raw);
        return doc.success ? normalizeOpenLibraryDoc(doc.data) : undefined;
      })
      .filter((seed): seed is BookSeed => seed !== undefined);
    return { ok: true, seeds };
  }

  async function searchGoogleBooks(query: BookQuery): Promise<UpstreamOutcome> {
    const fetched = await fetchBody("googlebooks", googleBooksUrl(query));
    if (!fetched.ok) return fetched;
    const parsed = googleVolumesSchema.safeParse(fetched.body);
    if (!parsed.success) {
      return {
        ok: false,
        source: "googlebooks",
        kind: "malformed",
        reason: "payload did not match the Google Books volumes shape",
      };
    }
    const seeds = (parsed.data.items ?? [])
      .map(normalizeGoogleVolume)
      .filter((seed): seed is BookSeed => seed !== undefined);
    return { ok: true, seeds };
  }

  async function search(rawQuery: BookQueryInput): Promise<BooksResult> {
    const query = bookQuerySchema.safeParse(rawQuery);
    if (!query.success) {
      return {
        ok: false,
        error: { code: "bad_request", message: z.prettifyError(query.error) },
      };
    }

    const key = cacheKey(query.data);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const failures: UpstreamFailure[] = [];
    for (const attempt of [searchOpenLibrary, searchGoogleBooks] as const) {
      const outcome = await attempt(query.data);
      if (!outcome.ok) {
        failures.push(outcome);
        continue;
      }
      const seeds =
        query.data.isbn !== undefined
          ? pickIsbnSeed(outcome.seeds, query.data.isbn)
          : outcome.seeds;
      const success: BooksSuccess = {
        ok: true,
        source: attempt === searchOpenLibrary ? "openlibrary" : "googlebooks",
        seeds,
      };
      cache.set(key, success);
      return success;
    }

    // Both upstreams failed. Malformed only when nothing was merely down —
    // an outage is the more actionable (and more likely) diagnosis.
    const code: BooksErrorCode = failures.every((f) => f.kind === "malformed")
      ? "upstream_malformed"
      : "upstream_unavailable";
    return {
      ok: false,
      error: {
        code,
        message: failures
          .map((f) => `${f.source}: ${f.reason}`)
          .join("; "),
        upstream: failures.map((f) => ({
          source: f.source,
          reason: f.reason,
        })),
      },
    };
  }

  return { search };
}

let defaultProvider: BooksProvider | undefined;

/** Module-level singleton so the route's LRU survives across requests. */
export function getBooksProvider(): BooksProvider {
  defaultProvider ??= createBooksProvider();
  return defaultProvider;
}
