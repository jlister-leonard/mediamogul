# Provider marks — E5.2/E5.3 provenance and rescope

Reviewed 2026-08-01. E5.2 and E5.3 are deliberately treated as one lease:
the registry decides whether an asset is lawful and usable, and the button
renders only that decision. A logo appears only when its provider publishes an
official asset (or sanctioned badge) plus enough display guidance for this
context. Otherwise `logoAsset` is `null` and the button uses exact-casing text.

No file or button claims trademark authorization, sponsorship, partnership, or
endorsement. Community logo collections and redrawn marks are not acceptable
provenance for this feature.

## Approved local assets

| Provider | Local file | Primary source | Constraint applied |
| --- | --- | --- | --- |
| Netflix | `netflix.png` | [Netflix Brand Site logos](https://brand.netflix.com/en/assets/logos/) and [terms](https://brand.netflix.com/en/terms/) | Official signature-gradient N, unmodified, on black. Do not place on red. Clear space is at least one leg width; the 24px-high N has more than that inside the 48px pill. Netflix publishes no numeric minimum for this asset. |
| Hulu | `hulu.svg` | [Hulu official brand kit](https://www.thisishulu.com/app/uploads/2023/11/Hulu-Logos.zip) | Official black secondary digital wordmark on Hulu green, 24px high and unmodified. Hulu's safe zone is the height of the `u`; the uninterrupted green pill field supplies that zone from other graphics (no suffix is used with this lockup). No numeric minimum is published in the kit. |
| Spotify | `spotify.svg` | [Spotify Design Guidelines](https://developer.spotify.com/documentation/design) and its official icon download | Official black primary icon on Spotify green, 24px high. This clears the 21px digital minimum; the 48px pill supplies the required exclusion zone of half the icon height above and below. No recoloring, stretching, or rotation. |
| Apple Podcasts | `apple-podcasts.png` | [Apple Podcasts Marketing Tools](https://tools.applemediaservices.com/podcast/1200361736), official `app-icon-podcasts/standard-25` badge endpoint, and [identity guidelines](https://www.apple.com/itunes/marketing-on-podcasts/identity-guidelines.html) | Official app icon at its sanctioned 25px display size, intrinsic ratio unchanged. Apple's published badge guidance uses 30px for the standard badge, 12px for the small badge, and 25px for lockups; the selected official endpoint is the 25px app-icon treatment. |

All approved assets are bundled locally. Runtime code never hotlinks them.

## Text fallbacks and blockers

These providers remain fully functional links, but display exact-casing text
instead of unverified art. That is intentional, not a missing-file failure.

| Provider | Primary-source check | Precise blocker |
| --- | --- | --- |
| HBO Max | [Warner Bros. Discovery press asset](https://press.wbd.com/us/image/hbomaxlogo?language_content_entity=en) | The official download requires press-account login; no public external-use license, minimum size, and clear-space rule were established. |
| Prime Video | [Amazon brand usage policy](https://advertising.amazon.com/resources/ad-policy/brand-usage) | Amazon-family logos require express approval. The sanctioned “Available at Amazon” badge has a 90px/140px minimum and would falsely label a Prime Video-specific handoff. |
| Apple TV+ | [Apple trademark guidelines](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html) | No sanctioned badge for a third-party link to the service, with applicable size and clear-space rules, was found. App Store badges license promotion of the developer's own app and are not a substitute. |
| Peacock | [Peacock press site](https://www.peacocktv.com/press) | No public external-use kit with license, minimum size, and clear-space rules was found. |
| Paramount+ | [Paramount brand page](https://www.paramount.com/brand/paramount-plus) | The page identifies the current mark but did not provide a reusable external-link asset with applicable display constraints. |
| Disney+ | [Disney+ Press logo page](https://press.disneyplus.com/about/disney-plus-logo-2024) | Press artwork is downloadable, but no external product-link usage grant, minimum size, or clear-space rule was established for this context. The downloaded review copy is therefore not shipped. |
| Audible | [Amazon brand usage policy](https://advertising.amazon.com/resources/ad-policy/brand-usage) | Amazon-family logo use requires express approval; the generic Amazon badge would misidentify the Audible destination. |
| Kindle | [Amazon brand usage policy](https://advertising.amazon.com/resources/ad-policy/brand-usage) | Amazon-family logo use requires express approval; the generic Amazon badge would misidentify the Kindle destination. |
| Bookshop.org | [Bookshop.org Terms of Use](https://bookshop.org/info/terms-of-use) | The terms reserve logo use absent permission; no approved external-link badge and display rules were found. |
| Fandango | [Fandango](https://www.fandango.com/) | No public official external-use kit with minimum size and clear-space guidance was found. |
| Overcast | [Overcast](https://overcast.fm/) | No formal public brand kit or sanctioned external-link badge with display constraints was found. |

## Rendering and remaining acceptance work

- Assets keep intrinsic aspect ratio and are never filtered, recolored,
  stretched, shadowed, or animated independently.
- The accessible provider name remains present in both image and text branches.
- E5.2's “official asset for every provider” acceptance item remains blocked for
  the eleven providers above; exact text is the safe operational fallback.
- E5.3's physical-iPhone acceptance item is still pending. Desktop/headless
  tests cannot prove whether each exact HTTPS path transfers to an installed
  app. Test with each relevant app installed and absent before calling any path
  a universal link.
