# Bundled provider marks — provenance and use constraints

E5.3 bundles every displayed mark locally. Runtime code never hotlinks a logo,
and `lib/providers/registry.ts` points each provider to the file listed here.
The marks identify outbound destinations; they do not imply sponsorship,
partnership, or endorsement.

## Retrieval record

Assets were retrieved on 2026-08-01. Most vector geometry comes from a pinned,
curated logo collection exposed by Iconify. This is the retrieval layer, not a
claim that Iconify owns the trademarks:

- **Simple Icons 16.27.1** (`simple-icons`): CC0 collection. Each entry records
  its originating brand/design source in the Simple Icons metadata.
- **Custom Brand Icons** (`cbi`): Emanuele & rchiileea, CC BY-NC-SA 4.0.
- **Arcticons** (`arcticons`): Arcticons Team, CC BY-SA 4.0.
- **Bookshop.org**: the wide PNG served by Bookshop.org's own Webflow CDN on its
  official About page, not a third-party redraw.

| Provider | Bundled file | Exact retrieval source | Brand / constraint source |
| --- | --- | --- | --- |
| Netflix | `netflix.svg` | `api.iconify.design/simple-icons/netflix.svg` | `brand.netflix.com/en/assets/logos`; do not alter the N geometry. |
| HBO Max | `hbo-max.svg` | `api.iconify.design/simple-icons/hbomax.svg` | Current 2025 black/white mark; Simple Icons cites the current Wikimedia vector. Do not substitute the legacy purple Max identity. |
| Prime Video | `prime-video.svg` | `api.iconify.design/cbi/prime-video.svg` | Amazon Ads brand-usage guidance; preserve the play/smile geometry and Prime blue. |
| Hulu | `hulu.svg` | `api.iconify.design/cbi/hulu.svg` | `press.hulu.com/branding` and `thisishulu.com`; lowercase mark, Hulu green/near-black pairing. |
| Apple TV+ | `apple-tv-plus.svg` | `api.iconify.design/simple-icons/appletv.svg` | Apple identity/marketing tools; preserve Apple glyph geometry and black/white pairing. |
| Peacock | `peacock.svg` | `api.iconify.design/cbi/peacock.svg` | NBCUniversal/Peacock identity; preserve the mark geometry and do not imply an NBCUniversal partnership. |
| Paramount+ | `paramount-plus.svg` | `api.iconify.design/simple-icons/paramountplus.svg` | `paramount.com/brand/paramount-plus`; preserve mountain, stars, and plus. |
| Disney+ | `disney-plus.svg` | `api.iconify.design/cbi/disney-plus.svg` | Disney+ press identity; preserve wordmark/arc geometry and white-on-navy treatment. |
| Spotify | `spotify.svg` | `api.iconify.design/simple-icons/spotify.svg` | Spotify Design & Branding Guidelines; 21px minimum digital size, black mark on Spotify Green. |
| Audible | `audible.svg` | `api.iconify.design/simple-icons/audible.svg` | Audible/Amazon identity; preserve the sound-wave mark and orange/black treatment. |
| Kindle | `kindle.svg` | `api.iconify.design/arcticons/kindle.svg` | Amazon trademark guidance applies; mark is used only to identify the linked Kindle destination. |
| Bookshop.org | `bookshop.png` | `cdn.prod.website-files.com/.../66df2a7dd732dd581f52b748_Bookshop-Logo-Wide.png` linked from `bookshop-webflow.bkshp.org/about-us` | Official wide logo, unmodified; do not imply affiliation. |
| Fandango | `fandango.svg` | `api.iconify.design/simple-icons/fandango.svg` | Simple Icons cites `fandango.com`; preserve ticket-F geometry and orange/black treatment. |
| Apple Podcasts | `apple-podcasts.svg` | `api.iconify.design/simple-icons/applepodcasts.svg` | Apple Podcasts Identity Guidelines; preserve antenna/rings and purple/white pairing. |
| Overcast | `overcast.svg` | `api.iconify.design/simple-icons/overcast.svg` | Simple Icons cites `overcast.fm`; no formal public kit was found, so use only as a destination identifier. |

## Rendering constraints

- Files are rendered at 24 CSS px high with intrinsic aspect ratio; they are
  never stretched, filtered, shadowed, animated independently, or recolored at
  runtime.
- The pill supplies at least 12px vertical and 20px horizontal clear space.
- Provider fields and mark colors are the pair recorded in the registry. The
  whole pill supplies the interactive hover/press affordance, leaving the mark
  itself unchanged.
- The interface keeps an accessible provider name even when the visual branch
  uses an image.

## Still pending

Whether each HTTPS path transfers to an installed native app is **not proved by
desktop or headless-browser tests**. E5.3's final “iOS tested” acceptance item
remains pending a physical iPhone pass with each relevant app installed and
again without it. Generic home/search fallbacks must not be described as
universal links until that pass succeeds for the exact path.
