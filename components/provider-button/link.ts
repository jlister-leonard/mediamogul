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
 * WEB URL, NOT THE CUSTOM SCHEME. `deepLink.app` is deliberately unused. Every
 * registry `web` URL is a universal link on iOS: tapping it opens the installed
 * native app and falls back to the browser when the app is absent — the exact
 * behavior PLAN §5 asks for, with no failure mode. A custom scheme (`nflx://`,
 * `spotify:`) has the opposite failure mode: with the app missing it dead-ends
 * on an error, and there is no way to detect that from a web page. Device
 * verification of the app-opening behavior is deferred to a physical iOS pass
 * (EPICS E5.3 "iOS tested"); it cannot be exercised in a headless browser.
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
