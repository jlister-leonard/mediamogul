/**
 * TMDB provider-id evidence used by E5.1.
 *
 * The current repository fixture was hand-built from TMDB's documented
 * watch-provider shape, not captured live. This environment has no
 * TMDB_API_KEY, so ad-supported tier ids cannot be verified here. We map
 * only ids already documented by the provider registry and deliberately do
 * not guess at separate ad-tier ids. A future captured `/watch/providers`
 * fixture can extend this record without changing availability semantics.
 */
export const TMDB_TIER_EVIDENCE = {
  verifiedLive: false,
  reason: "TMDB_API_KEY was not configured during the E5.1 audit",
  knownIds: {
    netflix: [8],
    "hbo-max": [1899, 384],
    "prime-video": [9, 10],
    hulu: [15],
    "apple-tv-plus": [350, 2],
    peacock: [386, 387],
    "paramount-plus": [531],
    "disney-plus": [337],
  },
  unknowns: [
    "No separate ad-tier ids were asserted; TMDB may group tiers under one storefront id.",
  ],
} as const;

export const AUDIBLE_CATALOG_EVIDENCE = {
  capturedLive: true,
  host: "api.audible.com",
  fixture: "lib/availability/fixtures/audible-bad-blood.json",
  officialDocumentationFound: false,
  isbnFilterReliable: false,
  identityRule: "one exact normalized title and complete author-set match",
  note: "The public Audible-owned endpoint answered live, but no official API documentation was found. A live ISBN filter was ignored and returned the general catalog, so ISBN and search URLs are never treated as availability evidence.",
} as const;
