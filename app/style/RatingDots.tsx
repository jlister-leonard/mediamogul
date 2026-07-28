import type { Gradient } from "@/lib/types";

/**
 * Your rating, in the library strip's currency.
 *
 * The teardown's sharpest correction (PLAN §2): Goodreads puts the community
 * average in list view and your own rating nowhere. Here the only rating
 * that appears anywhere on the screen is yours — three dots, filled to the
 * step you gave it, in the same lamplight the RatingGradient primitive uses.
 *
 * Decorative by itself; the enclosing link names it in prose.
 */

const filled: Record<Gradient, number> = { loved: 3, liked: 2, fine: 1, no: 0 };

/** Prose for the accessible name of whatever wraps this. */
export const ratingPhrase: Record<Gradient, string> = {
  loved: "you loved it",
  liked: "you liked it",
  fine: "you thought it was fine",
  no: "not for you",
};

export function RatingDots({ rating }: { rating: Gradient }) {
  return (
    <span aria-hidden className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={
            i < filled[rating]
              ? "size-1.5 rounded-full bg-accent"
              : "size-1.5 rounded-full border border-fg-muted"
          }
        />
      ))}
    </span>
  );
}
