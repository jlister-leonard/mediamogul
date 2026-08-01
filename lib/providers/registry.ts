// Relative (not "@/lib/types"): vitest's vite config resolves no path
// aliases, and every lib/ module keeps imports alias-free for that reason.
import { providerIdSchema, type ProviderId } from "../types";

/**
 * Provider registry (E5.2) — the one source of truth for every streaming and
 * commerce service Nightstand can hand you off to (PLAN §5). Every branded
 * button (E5.3), availability join (E5.1), and theaters link (E5.4) resolves
 * through this file. Adding a service is one entry here plus one optional
 * asset in `public/brands/` — nothing else.
 *
 * RAW-HEX SANCTION: E0.2's discipline is zero raw hex outside
 * `styles/tokens.css` (EPICS.md E0.2 AC). This file is the ONE sanctioned
 * exception: brand colors are external, verifiable facts owned by each
 * service, not design decisions — they cannot resolve through our token
 * system. `registry.test.ts` validates every value is well-formed hex; any
 * future automated raw-hex grep must allowlist exactly `styles/tokens.css`
 * and `lib/providers/registry.ts`.
 *
 * LOGO ASSETS: locally bundled provider marks are provenance-locked in
 * `public/brands/BRANDS.md`. ProviderButton never hotlinks or redraws them.
 */

/** #RRGGBB, uppercase — the shape `registry.test.ts` enforces. */
export type HexColor = `#${string}`;

export interface BrandColors {
  /** Button/tile background. */
  background: HexColor;
  /** Wordmark/logo color on that background. */
  foreground: HexColor;
  /**
   * Where the values come from. "official" = published in the service's brand
   * or press kit / design guidelines; "observed" = read off the service's own
   * product/marketing surfaces, to be confirmed against the kit when its
   * assets land (see public/brands/BRANDS.md for the kit URLs).
   */
  source: string;
}

/* ---------------------------------------------------------------- deep links
 * Each provider carries template(s) with typed params. `web` always exists as
 * an HTTPS fallback. Some destinations may transfer to installed apps through
 * associated domains, but that is provider/path specific and must not be
 * inferred merely from HTTPS. `app` is a custom-scheme URL, present only
 * where a scheme with a usable, publicly-known path syntax exists; a bare
 * scheme that can only open an app's home screen is worse than a universal
 * link, so those stay null (with the known scheme noted per entry).
 *
 * SEARCH-SCOPED, NOT TITLE-SCOPED: Nightstand holds no provider-internal
 * title ids, so every streaming deep link lands on the provider's SEARCH
 * results for the title — three taps to "+ My List", not the two PLAN §5
 * describes for a direct title link. Direct title links arrive later via
 * `availability.url` (lib/types/availability.ts) once E5.1 can resolve them
 * from TMDB watch-provider payloads.
 */

/** Movie/TV title straight from TMDB metadata (E2.2). */
export interface TitleParams {
  title: string;
}

/**
 * Book lookup. ISBN→ASIN CAVEAT: Kindle editions carry Amazon ASINs, which
 * are distinct from print ISBNs, and Amazon publishes no ISBN→ASIN mapping
 * API — so a guaranteed direct-to-detail-page Kindle link is impossible
 * without scraping. The honest, reliable move is a Kindle-store-scoped search
 * (`i=digital-text`) keyed on ISBN when we hold one — best-effort, unverified:
 * Amazon search usually surfaces the title's page family from a print ISBN,
 * but that behavior is observed, not contractual — else title + author.
 * Bookshop.org and Audible searches take the same params.
 */
export interface BookParams {
  title: string;
  author?: string;
  isbn13?: string;
}

/** Fandango title showtimes; ZIP remains local pending a documented provider contract. */
export interface ShowtimesParams {
  title: string;
  zip?: string;
}

/** Spotify show id resolved by E2.3 via Spotify's public search (PLAN §5). */
export interface SpotifyShowParams {
  spotifyShowId: string;
}

/** Apple iTunes podcast collection id used for metadata identity (E2.3). */
export interface ApplePodcastParams {
  appleId: number;
}

/**
 * Discriminated on `params` so consumers (E5.3, E5.1) can narrow to the right
 * argument shape at compile time. Every branch: `web` required, `app` nullable.
 */
export type DeepLink =
  | {
      params: "title";
      app: ((p: TitleParams) => string) | null;
      web: (p: TitleParams) => string;
    }
  | {
      params: "book";
      app: ((p: BookParams) => string) | null;
      web: (p: BookParams) => string;
    }
  | {
      params: "showtimes";
      app: ((p: ShowtimesParams) => string) | null;
      web: (p: ShowtimesParams) => string;
    }
  | {
      params: "spotifyShow";
      app: ((p: SpotifyShowParams) => string) | null;
      web: (p: SpotifyShowParams) => string;
    }
  | {
      params: "applePodcast";
      app: ((p: ApplePodcastParams) => string) | null;
      web: (p: ApplePodcastParams) => string;
    };

export interface ProviderEntry {
  id: ProviderId;
  /** Prose display name — "on Netflix", "buy on Bookshop.org". */
  name: string;
  /**
   * The wordmark text in the brand's exact official casing (NETFLIX is
   * all-caps, hulu is lowercase…). ProviderButton uses this only as a safe
   * fallback for an entry without a retained, verified-context local asset.
   */
  wordmark: string;
  brand: BrandColors;
  /** Local bundled provider mark (`/brands/{id}.svg` or `.png`). */
  logoAsset: string | null;
  /** Reviewed display height for the local asset; null when text fallback is used. */
  logoHeightPx: number | null;
  /**
   * TMDB watch-provider ids that resolve to this entry, so E5.1 can join
   * TMDB's `watch/providers` payloads (JustWatch-sourced) to the registry.
   * Ids per TMDB's own provider list (GET /watch/providers/movie|tv,
   * region US). Empty for services outside TMDB's coverage.
   *
   * NOTE (load-bearing for E5.1): availability `kind` must derive from the
   * TMDB payload array the provider appears in (flatrate/rent/buy), never
   * from the provider id — folds like 10→prime-video map one entry to both
   * subscription and rent/buy offers.
   */
  tmdbProviderIds: readonly number[];
  /** Exact HTTPS hosts accepted for provider-resolved `availability.url` values. */
  allowedHosts: readonly string[];
  deepLink: DeepLink;
}

/* ---------------------------------------------------------------- registry */

export const KNOWN_PROVIDER_IDS = [
  "netflix",
  "hbo-max",
  "prime-video",
  "hulu",
  "apple-tv-plus",
  "peacock",
  "paramount-plus",
  "disney-plus",
  "spotify",
  "audible",
  "kindle",
  "bookshop",
  "fandango",
  "overcast",
] as const;
export type KnownProviderId = (typeof KNOWN_PROVIDER_IDS)[number];

/** ProviderId is an open branded string (lib/types/ids.ts); brand the known keys once. */
const pid = (id: KnownProviderId): ProviderId => providerIdSchema.parse(id);

const enc = encodeURIComponent;

/** ISBN when we hold one (near-exact on retailer search), else title + author. */
const bookQuery = (p: BookParams): string =>
  p.isbn13 ?? [p.title, p.author].filter(Boolean).join(" ");

export const providerRegistry: Readonly<
  Record<KnownProviderId, ProviderEntry>
> = {
  netflix: {
    id: pid("netflix"),
    name: "Netflix",
    wordmark: "NETFLIX",
    brand: {
      background: "#000000",
      foreground: "#E50914",
      source:
        "official identity colors — Netflix red on black per brand.netflix.com; exact-casing text fallback uses the measured accessible text treatment",
    },
    logoAsset: null,
    logoHeightPx: null,
    tmdbProviderIds: [8],
    allowedHosts: ["netflix.com", "www.netflix.com"],
    deepLink: {
      params: "title",
      // nflx:// is Netflix's long-standing mobile scheme; the search path
      // mirrors the web app's. Not formally documented, but stable for years.
      app: (p) => `nflx://www.netflix.com/search?q=${enc(p.title)}`,
      web: (p) => `https://www.netflix.com/search?q=${enc(p.title)}`,
    },
  },

  "hbo-max": {
    id: pid("hbo-max"),
    name: "HBO Max",
    wordmark: "HBO Max",
    brand: {
      background: "#000000",
      foreground: "#FFFFFF",
      source:
        "official — the 2025 return-to-HBO-Max rebrand is a black-and-white identity (Warner Bros. Discovery press, press.wbd.com)",
    },
    logoAsset: null,
    logoHeightPx: null,
    // 1899 = current HBO Max (carried through the Max era); 384 = the legacy
    // HBO Max id still present in older cached payloads.
    tmdbProviderIds: [1899, 384],
    allowedHosts: ["hbomax.com", "www.hbomax.com", "play.hbomax.com"],
    deepLink: {
      params: "title",
      // No verified public search route survived the Max→HBO Max renames.
      // A direct availability.url should override this honest homepage.
      app: null,
      web: () => "https://www.hbomax.com/",
    },
  },

  "prime-video": {
    id: pid("prime-video"),
    name: "Prime Video",
    wordmark: "prime video",
    brand: {
      background: "#0F171E",
      foreground: "#00A8E1",
      source:
        "official/observed — Prime blue #00A8E1 per Amazon brand usage guidelines; #0F171E is the Prime Video app's dark canvas, observed, confirm against kit",
    },
    logoAsset: null,
    logoHeightPx: null,
    // 9 = Prime Video (subscription); 10 = Amazon Video (rent/buy) — both
    // land on the same storefront, so both render the Prime Video button.
    tmdbProviderIds: [9, 10],
    allowedHosts: [
      "primevideo.com",
      "www.primevideo.com",
      "amazon.com",
      "www.amazon.com",
    ],
    deepLink: {
      params: "title",
      // The historical aiv:// scheme's paths are undocumented. This HTTPS
      // search is the fallback; native-app transfer remains device-unverified.
      app: null,
      web: (p) => `https://www.primevideo.com/search?phrase=${enc(p.title)}`,
    },
  },

  hulu: {
    id: pid("hulu"),
    name: "Hulu",
    wordmark: "hulu",
    brand: {
      background: "#1CE783",
      foreground: "#040405",
      source:
        "official — Hulu green #1CE783 with near-black #040405, per Hulu press/brand assets (press.hulu.com)",
    },
    logoAsset: "/brands/hulu.svg",
    logoHeightPx: 24,
    tmdbProviderIds: [15],
    allowedHosts: ["hulu.com", "www.hulu.com"],
    deepLink: {
      params: "title",
      // hulu:// exists but its action paths are undocumented. Use the working
      // HTTPS search without claiming associated-domain behavior.
      app: null,
      web: (p) => `https://www.hulu.com/search?q=${enc(p.title)}`,
    },
  },

  "apple-tv-plus": {
    id: pid("apple-tv-plus"),
    name: "Apple TV+",
    wordmark: "Apple TV+",
    brand: {
      background: "#000000",
      foreground: "#FFFFFF",
      source:
        "official — Apple TV+ identity is white-on-black (Apple Media Services marketing badges, tools.applemediaservices.com)",
    },
    logoAsset: null,
    logoHeightPx: null,
    // 350 = Apple TV+ (subscription); 2 = Apple TV (the rent/buy store) —
    // both open tv.apple.com.
    tmdbProviderIds: [350, 2],
    allowedHosts: ["tv.apple.com"],
    deepLink: {
      params: "title",
      // Use the working HTTPS search. Exact installed-app behavior for this
      // path remains part of the physical-iOS acceptance pass.
      app: null,
      web: (p) => `https://tv.apple.com/us/search?term=${enc(p.title)}`,
    },
  },

  peacock: {
    id: pid("peacock"),
    name: "Peacock",
    wordmark: "peacock",
    brand: {
      background: "#000000",
      foreground: "#FFFFFF",
      source:
        "official — Peacock's lowercase wordmark renders white-on-black in NBCUniversal press materials (the multicolor feather is the kit asset)",
    },
    logoAsset: null,
    logoHeightPx: null,
    // 386 = Peacock Premium; 387 = Peacock Premium Plus.
    tmdbProviderIds: [386, 387],
    allowedHosts: ["peacocktv.com", "www.peacocktv.com"],
    deepLink: {
      params: "title",
      // Peacock's former /search route now returns 404. Prefer a direct
      // availability.url; without one, link only to the working homepage.
      app: null,
      web: () => "https://www.peacocktv.com/",
    },
  },

  "paramount-plus": {
    id: pid("paramount-plus"),
    name: "Paramount+",
    wordmark: "Paramount+",
    brand: {
      background: "#0064FF",
      foreground: "#FFFFFF",
      source:
        "official — Paramount+ launch-identity blue #0064FF with white wordmark (Paramount Press Express brand assets)",
    },
    logoAsset: null,
    logoHeightPx: null,
    tmdbProviderIds: [531],
    allowedHosts: ["paramountplus.com", "www.paramountplus.com"],
    deepLink: {
      params: "title",
      // This is a working web search, not an associated-domain app path.
      app: null,
      web: (p) => `https://www.paramountplus.com/search/?q=${enc(p.title)}`,
    },
  },

  "disney-plus": {
    id: pid("disney-plus"),
    name: "Disney+",
    wordmark: "Disney+",
    brand: {
      background: "#040714",
      foreground: "#FFFFFF",
      source:
        "observed — Disney+ app/marketing midnight-navy canvas #040714 with white wordmark; confirm against press.disneyplus.com kit",
    },
    logoAsset: null,
    logoHeightPx: null,
    tmdbProviderIds: [337],
    allowedHosts: ["disneyplus.com", "www.disneyplus.com"],
    deepLink: {
      params: "title",
      // The former generated /search?q= destination returns 404. Prefer a
      // direct availability.url; otherwise use the working service homepage.
      app: null,
      web: () => "https://www.disneyplus.com/",
    },
  },

  spotify: {
    id: pid("spotify"),
    name: "Spotify",
    wordmark: "Spotify",
    brand: {
      background: "#1ED760",
      foreground: "#000000",
      source:
        "official — Spotify Green #1ED760, logo in black, per Spotify Design & Branding Guidelines (developer.spotify.com/documentation/design)",
    },
    logoAsset: null,
    logoHeightPx: null,
    tmdbProviderIds: [],
    allowedHosts: ["open.spotify.com"],
    deepLink: {
      params: "spotifyShow",
      // Spotify URIs are officially documented: spotify:show:{id}.
      app: (p) => `spotify:show:${enc(p.spotifyShowId)}`,
      web: (p) => `https://open.spotify.com/show/${enc(p.spotifyShowId)}`,
    },
  },

  audible: {
    id: pid("audible"),
    name: "Audible",
    wordmark: "audible",
    brand: {
      background: "#F8991C",
      foreground: "#000000",
      source:
        "observed — Audible orange #F8991C with black lowercase wordmark, from Audible's own product surfaces; confirm against Amazon brand kit",
    },
    logoAsset: null,
    logoHeightPx: null,
    tmdbProviderIds: [],
    allowedHosts: ["audible.com", "www.audible.com"],
    deepLink: {
      params: "book",
      app: null,
      web: (p) => `https://www.audible.com/search?keywords=${enc(bookQuery(p))}`,
    },
  },

  kindle: {
    id: pid("kindle"),
    name: "Kindle",
    wordmark: "kindle",
    brand: {
      background: "#232F3E",
      foreground: "#FF9900",
      source:
        "official hexes — Amazon palette Squid Ink #232F3E and Amazon Orange #FF9900 per Amazon brand usage guidelines; the PAIRING is our button choice, pending kit lockup rules",
    },
    logoAsset: null,
    logoHeightPx: null,
    tmdbProviderIds: [],
    allowedHosts: ["amazon.com", "www.amazon.com"],
    deepLink: {
      params: "book",
      // i=digital-text scopes the search to the Kindle store. See BookParams
      // for the ISBN→ASIN caveat this search-based link exists to absorb.
      // Clean link, no affiliate tags (PLAN §5).
      app: null,
      web: (p) =>
        `https://www.amazon.com/s?k=${enc(bookQuery(p))}&i=digital-text`,
    },
  },

  bookshop: {
    id: pid("bookshop"),
    name: "Bookshop.org",
    wordmark: "BOOKSHOP.ORG",
    brand: {
      background: "#FFFFFF",
      foreground: "#211E1E",
      source:
        "observed — Bookshop.org's all-caps wordmark renders near-black ink on white on its own storefront; confirm against bookshop.org/pages/press kit",
    },
    logoAsset: null,
    logoHeightPx: null,
    tmdbProviderIds: [],
    allowedHosts: ["bookshop.org", "www.bookshop.org"],
    deepLink: {
      params: "book",
      // Bookshop search resolves ISBNs directly to the edition page.
      app: null,
      web: (p) => `https://bookshop.org/search?keywords=${enc(bookQuery(p))}`,
    },
  },

  fandango: {
    id: pid("fandango"),
    name: "Fandango",
    wordmark: "FANDANGO",
    brand: {
      background: "#FF7300",
      foreground: "#FFFFFF",
      source:
        "observed — Fandango orange #FF7300 with white all-caps wordmark, from Fandango's own surfaces; confirm against corporate press kit",
    },
    logoAsset: null,
    logoHeightPx: null,
    tmdbProviderIds: [],
    allowedHosts: ["fandango.com", "www.fandango.com"],
    deepLink: {
      params: "showtimes",
      // Fandango documents title search, but no stable title+ZIP URL contract.
      // ShowtimesParams retains local ZIP for a future approved contract; it
      // must not leave Nightstand through an invented query parameter.
      app: null,
      web: (p) => `https://www.fandango.com/search?q=${enc(p.title)}`,
    },
  },

  overcast: {
    id: pid("overcast"),
    name: "Overcast",
    wordmark: "Overcast",
    brand: {
      background: "#FC7E0F",
      foreground: "#FFFFFF",
      source:
        "observed — Overcast's app orange #FC7E0F with white wordmark, from the app's own identity; no formal kit published",
    },
    logoAsset: null,
    logoHeightPx: null,
    tmdbProviderIds: [],
    allowedHosts: ["overcast.fm", "www.overcast.fm"],
    deepLink: {
      params: "applePodcast",
      // Overcast's documented x-callback route needs an RSS URL, which this
      // model does not hold. The associated /+itunes{id} path returns 404 in a
      // browser, so the safe web fallback is deliberately the working home
      // page rather than a false title destination.
      app: null,
      web: () => "https://overcast.fm/",
    },
  },
};

/** Every entry, in KNOWN_PROVIDER_IDS order — for iteration (E5.5 action row). */
export const providerEntries: readonly ProviderEntry[] = KNOWN_PROVIDER_IDS.map(
  (id) => providerRegistry[id],
);

/** Resolve an open ProviderId (e.g. off a stored Availability row) to its entry. */
export function getProvider(id: ProviderId | string): ProviderEntry | undefined {
  return (providerRegistry as Record<string, ProviderEntry | undefined>)[id];
}

const byTmdbId = new Map<number, ProviderEntry>(
  providerEntries.flatMap((entry) =>
    entry.tmdbProviderIds.map((tmdbId) => [tmdbId, entry] as const),
  ),
);

/**
 * The E5.1 join: TMDB `watch/providers` payload's `provider_id` → registry
 * entry. Undefined for providers we don't hold (a subscription nobody on this
 * nightstand pays for renders nothing, PLAN §5).
 */
export function providerForTmdbId(
  tmdbProviderId: number,
): ProviderEntry | undefined {
  return byTmdbId.get(tmdbProviderId);
}
