import { cx } from "@/components/ui/util";
import { ProviderButton, type ProviderButtonProps } from "./ProviderButton";
import { RingScroller } from "./RingScroller";

export interface GetItRowProps {
  /**
   * Names the row for assistive tech — "Get The Overstory". The visible
   * heading, if any, belongs to the surface that places the row.
   */
  label: string;
  /**
   * ALREADY ORDERED. GetItRow renders this array exactly as given and never
   * sorts, filters, or dedupes it — deciding what comes first (subscribed
   * sources, then rent/buy, then theaters; Kindle/Audible for books;
   * Spotify-first for podcasts) is E5.5's job, and the empty state is E5.5's
   * too: an empty array renders nothing rather than a silent blank strip.
   */
  items: readonly ProviderButtonProps[];
  className?: string;
}

/**
 * The layout the branded buttons live in: one horizontal, scrollable line.
 *
 * Against Goodreads' single grey PREVIEW button, this row is the difference
 * between a database and a concierge — so it is laid out to be read at a
 * glance, not scanned like a toolbar: generous gaps, an honest edge, and the
 * scroll only starts when there are genuinely more ways to get a title than
 * fit on a phone.
 *
 * PARENT CONTRACT: this row bleeds 16px past its parent's content box on each
 * side and pays that back as its own padding, so the pills line up with the
 * text above them while the focus ring still has room. **The parent must
 * supply at least 16px of horizontal padding.** Dropped into a flush-to-the-
 * edge container it will push the page into horizontal scroll.
 *
 * THE EDGE IS FADED, NOT CUT. When a row overflows, the pill at the edge is
 * genuinely cropped — that is what a scroller does — but a hard vertical slice
 * through a wordmark reads as a rendering error rather than as "there is more
 * over here", and once kit art lands it would be a sliced logo, which every
 * kit in `public/brands/BRANDS.md` forbids. So the scrollport is masked to
 * transparent over its outermost 8px.
 *
 * The numbers are one system, and they are the reason the fade never eats a
 * focus ring: 16px of padding inside the scrollport, the same 16px of
 * `scroll-padding` so a pill scrolled to an edge stops in the same place, an
 * 8px fade, and a ring that sits 4px outside the pill. Any pill at any edge is
 * therefore 16px in, its ring 12px in, and the fade ends at 8px — 4px of
 * daylight. `scroll-padding` (not `scroll-margin`) is load-bearing; see
 * `RingScroller` for the measurement behind that.
 */
export function GetItRow({ label, items, className }: GetItRowProps) {
  if (items.length === 0) return null;

  return (
    <RingScroller
      className={cx(
        // An overflow scroller clips BOTH axes, and the focus ring sits 4px
        // outside the pill — so the scroller carries that much room on every
        // edge and gives the horizontal room back with a negative margin.
        "-mx-4 -my-2 overflow-x-auto overscroll-x-contain py-2",
        // Safe-area aware: on a notched phone held in landscape the first and
        // last pill stay clear of the rounded corners and the sensor housing.
        "ps-[max(1rem,env(safe-area-inset-left))] pe-[max(1rem,env(safe-area-inset-right))]",
        // Where a scrolled-to pill comes to rest. Honored by RingScroller's
        // explicit scrollIntoView; the browser's own focus scrolling honors
        // neither this nor scroll-margin, which is why that handler exists.
        "scroll-px-4",
        "[mask-image:linear-gradient(to_right,transparent_0,black_8px,black_calc(100%_-_8px),transparent_100%)]",
        "[-webkit-mask-image:linear-gradient(to_right,transparent_0,black_8px,black_calc(100%_-_8px),transparent_100%)]",
        // A permanent scrollbar under a row of four buttons is chrome the
        // design does not need; keyboard users still reach every pill by tab,
        // which scrolls the container to it.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <ul aria-label={label} className="flex w-max items-center gap-3">
        {items.map((item, index) => (
          // A provider can appear twice in one row (Prime Video rents *and*
          // sells), and E5.5 may legitimately repeat an identical offer, so
          // position is part of the identity.
          <li
            key={`${item.provider.id}:${item.suffix ?? ""}:${index}`}
            className="shrink-0"
          >
            <ProviderButton {...item} />
          </li>
        ))}
      </ul>
    </RingScroller>
  );
}
