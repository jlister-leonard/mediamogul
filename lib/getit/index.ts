import type { ProviderButtonProps } from "../../components/provider-button/ProviderButton";
import {
  getProvider,
  providerEntries,
  providerRegistry,
  type BookParams,
  type ProviderEntry,
} from "../providers/registry";
import type { Availability, Item } from "../types";

export interface GetItComposition {
  /** Already ordered for the presentation-only GetItRow component. */
  items: readonly ProviderButtonProps[];
  /** Present only when no provider has reported an actionable offer. */
  emptyState?: {
    message: string;
    alternativeLabel: string;
  };
}

const VIDEO_KIND_RANK: Readonly<Record<Availability["kind"], number>> = {
  subscription: 0,
  rent: 1,
  buy: 2,
  theater: 3,
};

const PROVIDER_RANK = new Map(
  providerEntries.map((provider, index) => [String(provider.id), index]),
);

/** $999.99 keeps even the longest commerce suffix compact on a phone. */
const MAX_DISPLAY_PRICE_CENTS = 99_999;

/**
 * Turn provider evidence into one deterministic, display-ready action row.
 * This function is deliberately pure: callers may safely use it during render,
 * and shuffled IndexedDB rows always produce the same order.
 */
export function composeGetIt(
  item: Item,
  availability: readonly Availability[],
  options: { zip?: string } = {},
): GetItComposition {
  // Compatibility-only until Fandango publishes a supported title+ZIP
  // contract. The local ZIP must not reach any fallback link.
  void options;
  const offers = availability
    .filter((offer) => offer.itemId === item.id)
    .slice()
    .sort(compareOffers);

  switch (item.medium) {
    case "book":
      return { items: composeBook(item, offers) };
    case "podcast":
      return { items: composePodcast(item, offers) };
    case "movie":
    case "tv": {
      const items = offers.flatMap((offer) =>
        buttonForOffer(item, offer),
      );
      if (items.length > 0) return { items };

      // This is a search, not evidence that the title is rentable. Keeping the
      // distinction in copy prevents a useful fallback from becoming a false
      // availability claim.
      return {
        items: [{
          provider: providerRegistry["prime-video"],
          link: { params: "title", title: item.title },
          suffix: "check rentals",
        }],
        emptyState: {
          message: "Not streamable right now.",
          alternativeLabel: "Best alternative",
        },
      };
    }
  }
}

/** Short suffixes preserve the action row's one-line, phone-width geometry. */
export function availabilitySuffix(offer: Availability): string {
  switch (offer.kind) {
    case "subscription":
      return "included";
    case "theater":
      return "showtimes";
    case "rent":
    case "buy": {
      const price = formatPrice(offer.priceUsd);
      return price === undefined ? offer.kind : `${offer.kind} ${price}`;
    }
  }
}

function composeBook(
  item: Extract<Item, { medium: "book" }>,
  offers: readonly Availability[],
): ProviderButtonProps[] {
  const params: BookParams = {
    title: item.title,
    ...(item.creators[0] !== undefined && { author: item.creators[0] }),
    ...(item.ref.isbn13 !== undefined && { isbn13: item.ref.isbn13 }),
  };
  const audibleOffer = offers.find(
    (offer) => "providerId" in offer && offer.providerId === "audible",
  );

  return [
    { provider: providerRegistry.kindle, link: { params: "book", ...params } },
    audibleOffer === undefined
      ? { provider: providerRegistry.audible, link: { params: "book", ...params } }
      : offerButton(providerRegistry.audible, audibleOffer, {
          params: "book",
          ...params,
        }),
    { provider: providerRegistry.bookshop, link: { params: "book", ...params } },
  ];
}

function composePodcast(
  item: Extract<Item, { medium: "podcast" }>,
  offers: readonly Availability[],
): ProviderButtonProps[] {
  const items: ProviderButtonProps[] = [];
  if (item.ref.spotifyShowId !== undefined) {
    const spotifyOffer = offers.find(
      (offer) => "providerId" in offer && offer.providerId === "spotify",
    );
    items.push(
      spotifyOffer === undefined
        ? {
            provider: providerRegistry.spotify,
            link: {
              params: "spotifyShow",
              spotifyShowId: item.ref.spotifyShowId,
            },
          }
        : offerButton(providerRegistry.spotify, spotifyOffer, {
            params: "spotifyShow",
            spotifyShowId: item.ref.spotifyShowId,
          }),
    );
  }

  if (item.ref.appleId !== undefined) {
    const link = { params: "applePodcast" as const, appleId: item.ref.appleId };
    items.push({ provider: providerRegistry.overcast, link });
  }

  if (items.length > 0) return items;
  return [{
    provider: providerRegistry.overcast,
    href: "https://overcast.fm/",
    suffix: "open app",
  }];
}

function buttonForOffer(
  item: Extract<Item, { medium: "movie" | "tv" }>,
  offer: Availability,
): ProviderButtonProps[] {
  if (offer.kind === "theater") {
    return [offerButton(
      providerRegistry.fandango,
      offer,
      { params: "showtimes", title: item.title },
    )];
  }
  const provider = getProvider(offer.providerId);
  if (provider === undefined || provider.deepLink.params !== "title") return [];
  return [offerButton(provider, offer, { params: "title", title: item.title })];
}

function offerButton(
  provider: ProviderEntry,
  offer: Availability,
  link: ProviderButtonProps["link"],
): ProviderButtonProps {
  const direct = offer.kind === "theater" ? offer.fandangoUrl : offer.url;
  return direct !== undefined && allowedDirectUrl(provider, direct)
    ? { provider, href: direct, suffix: availabilitySuffix(offer) }
    : { provider, link: link!, suffix: availabilitySuffix(offer) };
}

function compareOffers(left: Availability, right: Availability): number {
  return (
    VIDEO_KIND_RANK[left.kind] - VIDEO_KIND_RANK[right.kind] ||
    providerRank(left) - providerRank(right) ||
    priceRank(left) - priceRank(right) ||
    directUrl(left).localeCompare(directUrl(right)) ||
    left.fetchedAt.localeCompare(right.fetchedAt)
  );
}

function providerRank(offer: Availability): number {
  if (offer.kind === "theater") return Number.MAX_SAFE_INTEGER;
  return PROVIDER_RANK.get(String(offer.providerId)) ?? Number.MAX_SAFE_INTEGER - 1;
}

function priceRank(offer: Availability): number {
  return offer.kind === "rent" || offer.kind === "buy"
    ? offer.priceUsd ?? Number.MAX_SAFE_INTEGER
    : 0;
}

function directUrl(offer: Availability): string {
  return offer.kind === "theater" ? offer.fandangoUrl ?? "" : offer.url ?? "";
}

function formatPrice(price: number | undefined): string | undefined {
  if (price === undefined || !Number.isFinite(price) || price <= 0) return undefined;
  const cents = Math.round((price + Number.EPSILON) * 100);
  if (
    !Number.isSafeInteger(cents) ||
    cents < 1 ||
    cents > MAX_DISPLAY_PRICE_CENTS
  ) {
    return undefined;
  }
  return `$${(cents / 100).toFixed(2)}`;
}

function allowedDirectUrl(provider: ProviderEntry, value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      provider.allowedHosts.includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}
