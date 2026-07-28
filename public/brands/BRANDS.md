# Brand assets — sourcing, slots, and constraints (E5.2)

No brand-asset host is reachable from the build environment, and hand-drawing
logo geometry produces off-brand marks — so **no logo files ship yet**. Until a
provider's official kit SVG lands in its slot below and its registry entry's
`logoAsset` is set, **ProviderButton (E5.3) renders the provider's wordmark
(exact official casing) on its brand colors** from
`lib/providers/registry.ts`. That registry is the single source of truth for
colors, wordmarks, and deep links; this file is the sourcing manifest for the
art.

**Swap-in procedure (per provider):** download the mark from the official kit
URL below → save as the exact slot path → set `logoAsset: "/brands/{id}.svg"`
in `lib/providers/registry.ts` → done. No component or test changes.

**Universal constraints** (each kit states variants of the same rules): use the
mark unaltered — no recoloring, stretching, effects, or redrawing; keep the
kit's minimum clear space and minimum size; only brand-approved background
colors behind the mark; never imply endorsement or partnership. E5.3 encodes
clear-space and minimum-size handling; per-mark specifics below.

| Provider | Slot (drop file here) | Official kit / source | Constraint notes |
| --- | --- | --- | --- |
| Netflix | `public/brands/netflix.svg` | brand.netflix.com | Use full NETFLIX wordmark or "N" symbol as provided; Netflix Red #E50914; no alteration of letterforms; dark backgrounds preferred. |
| HBO Max | `public/brands/hbo-max.svg` | press.wbd.com (Warner Bros. Discovery press site) | 2025 identity is black/white; use current HBO Max lockup, not legacy Max-era purple/blue art. |
| Prime Video | `public/brands/prime-video.svg` | Amazon brand usage guidelines (advertising.amazon.com/resources/ad-policy/brand-usage) | Lowercase "prime video" lockup with smile arc; Prime blue #00A8E1; Amazon marks need Amazon's usage approval. |
| Hulu | `public/brands/hulu.svg` | press.hulu.com | Lowercase wordmark; Hulu green #1CE783 on black/white only. |
| Apple TV+ | `public/brands/apple-tv-plus.svg` | tools.applemediaservices.com (Apple Media Services marketing tools) | Use Apple-generated badge/lockup only; Apple logo glyph must never be recreated; white-on-black. |
| Peacock | `public/brands/peacock.svg` | NBCUniversal press (press.nbcuniversal.com) | Lowercase wordmark; multicolor feather may not be recolored or reordered. |
| Paramount+ | `public/brands/paramount-plus.svg` | Paramount Press Express (paramountpressexpress.com) | Mountain-and-stars lockup; brand blue #0064FF; keep the "+" as drawn. |
| Disney+ | `public/brands/disney-plus.svg` | press.disneyplus.com | Wordmark with arc; white on Disney+ navy; do not separate arc from wordmark. |
| Spotify | `public/brands/spotify.svg` | developer.spotify.com/documentation/design (official design & branding guidelines) | The most prescriptive kit: Spotify Green #1ED760 only with black or white; minimum size 21px digital; icon never modified; guidelines explicitly cover third-party app usage. |
| Audible | `public/brands/audible.svg` | Audible newsroom / Amazon brand usage guidelines | Lowercase wordmark with origin-arrow; Audible orange; Amazon-family approval rules apply. |
| Kindle | `public/brands/kindle.svg` | Amazon brand usage guidelines | Lowercase wordmark; Amazon-family approval rules apply. |
| Bookshop.org | `public/brands/bookshop.svg` | bookshop.org/pages/press | All-caps wordmark with pennant glyph; affiliate program has its own asset pack — we use clean non-affiliate links (PLAN §5). |
| Fandango | `public/brands/fandango.svg` | Fandango corporate press office | All-caps wordmark; orange field; ticket glyph as provided. |
| Apple Podcasts | `public/brands/apple-podcasts.svg` | Apple Podcasts identity guidelines + tools.applemediaservices.com | Use Apple-generated "Listen on Apple Podcasts" badge or icon exactly as exported; purple gradient icon never redrawn. |
| Overcast | `public/brands/overcast.svg` | overcast.fm (no formal kit; icon/wordmark used by app-linking convention) | No published kit — request permission or use plain wordmark rendering indefinitely. |

Brand *colors* used meanwhile are recorded per entry in
`lib/providers/registry.ts` with a `source` note grading each value
`official` (published in the kit/guidelines) or `observed` (read off the
service's own surfaces, to be confirmed when the kit is pulled). That registry
file is the one sanctioned raw-hex location outside `styles/tokens.css`
(EPICS.md E0.2 discipline) — brand colors are external facts, not tokens.
