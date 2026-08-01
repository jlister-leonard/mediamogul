/**
 * Building a provider's outbound URL from typed arguments (E5.3).
 *
 * `DeepLink` in the registry is discriminated on `params`, and this module is
 * where that discriminant is narrowed: the caller passes arguments tagged with
 * the same discriminant, so a Spotify show id can never be handed to Netflix's
 * title template at compile time. The runtime guard exists for the one case the
 * types cannot cover — an entry resolved dynamically (e.g. from a stored
 * `Availability.providerId`) whose template shape disagrees with the arguments.
 *
 * HTTPS, NOT AN UNVERIFIED APP CLAIM. `deepLink.app` is deliberately unused:
 * custom schemes (`nflx://`, `spotify:`) dead-end when the app is absent and a
 * web page cannot reliably detect installation. Some registry HTTPS URLs are
 * associated-domain links and some are ordinary web fallbacks; this module
 * does not call all of them "universal links." When E5.1 supplies a provider's
 * direct `availability.url`, ProviderButton accepts it as an explicit `href`
 * override instead of rebuilding a weaker search destination here.
 *
 * Which HTTPS destinations actually transfer to an installed app remains a
 * physical-iOS acceptance pass. Headless Chromium cannot prove it.
 */

import type {
  ApplePodcastParams,
  BookParams,
  ProviderEntry,
  ShowtimesParams,
  SpotifyShowParams,
  TitleParams,
} from "@/lib/providers/registry";

/**
 * What a provider needs to build its link, tagged with the same discriminant
 * the registry's `DeepLink` carries.
 */
export type ProviderLinkArgs =
  | ({ params: "title" } & TitleParams)
  | ({ params: "book" } & BookParams)
  | ({ params: "showtimes" } & ShowtimesParams)
  | ({ params: "spotifyShow" } & SpotifyShowParams)
  | ({ params: "applePodcast" } & ApplePodcastParams);

/** The provider's web URL for these arguments. */
export function providerWebUrl(
  entry: ProviderEntry,
  args: ProviderLinkArgs,
): string {
  const { deepLink } = entry;
  switch (args.params) {
    case "title":
      if (deepLink.params === "title") return deepLink.web(args);
      break;
    case "book":
      if (deepLink.params === "book") return deepLink.web(args);
      break;
    case "showtimes":
      if (deepLink.params === "showtimes") return deepLink.web(args);
      break;
    case "spotifyShow":
      if (deepLink.params === "spotifyShow") return deepLink.web(args);
      break;
    case "applePodcast":
      if (deepLink.params === "applePodcast") return deepLink.web(args);
      break;
  }
  throw new Error(
    `${entry.id} takes "${deepLink.params}" link arguments, received "${args.params}"`,
  );
}
