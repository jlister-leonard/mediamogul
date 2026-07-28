import { cx } from "@/components/ui/util";
import { ProviderButton, type ProviderButtonProps } from "./ProviderButton";

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
 * glance, not scanned like a toolbar: generous gaps, nothing cropped, and the
 * scroll only starts when there are genuinely more ways to get a title than
 * fit on a phone.
 */
export function GetItRow({ label, items, className }: GetItRowProps) {
  if (items.length === 0) return null;

  return (
    <div
      className={cx(
        // An overflow scroller clips BOTH axes, and the focus ring sits 4px
        // outside the pill — so the scroller carries that much room on every
        // edge and gives the horizontal room back with a negative margin. The
        // row occupies exactly the space it would without the scroller, and no
        // focus ring is ever cut in half.
        "-mx-4 -my-2 overflow-x-auto overscroll-x-contain py-2",
        // Safe-area aware: on a notched phone held in landscape the first and
        // last pill stay clear of the rounded corners and the sensor housing.
        "ps-[max(1rem,env(safe-area-inset-left))] pe-[max(1rem,env(safe-area-inset-right))]",
        // A permanent scrollbar under a row of four buttons is chrome the
        // design does not need; keyboard users still reach every pill by tab,
        // which scrolls the container to it.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <ul aria-label={label} className="flex w-max items-center gap-3">
        {items.map((item) => (
          // A provider can appear twice in one row (Prime Video rents *and*
          // sells), so the suffix is part of the identity.
          <li
            key={`${item.provider.id}:${item.suffix ?? ""}`}
            className="shrink-0"
          >
            <ProviderButton {...item} />
          </li>
        ))}
      </ul>
    </div>
  );
}
