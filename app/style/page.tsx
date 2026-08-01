import type { Metadata } from "next";
import type { Gradient } from "@/lib/types";
import { Button, Chip, TabBar, type TabBarItem } from "@/components/ui";
import { cx, focusRing } from "@/components/ui/util";
import { Cover, coverArt, type CoverId } from "./Cover";
import { HeroRec } from "./HeroRec";
import { RatingDots, ratingPhrase } from "./RatingDots";
import "./tile.css";

/**
 * E0.7 — the style tile. Not a swatch board: one real, composed screen, a
 * plausible slice of the Tonight tab (PLAN §4.4), built at 390px first so
 * the look is judged the way the app is actually held.
 *
 * It is written as the rebuttal to the teardown in PLAN §2, line by line:
 * the art is the hero rather than a thumbnail; the subtitle is demoted to
 * one grey line; the only rating anywhere on screen is yours; "date added"
 * is replaced by why the thing is in front of you; every item ends in an
 * action; there are no ads, no borders-everywhere, and nothing sits on top
 * of anything else.
 *
 * EVERY CLAIM ON THIS SCREEN SURVIVES A GREP OF THE CORPUS. The screen's
 * whole argument is "the app knows you", so a sentence that only sounds
 * personal is worse here than no sentence at all — and a wrong claim about a
 * date-added is the exact register the teardown mocks. Sourced from
 * `data/goodreads_library_export.csv` and TASTE-BASELINE Finding 7:
 *
 *   · the five most recent additions to the to-read shelf (all 2026/07/05)
 *     are Inside the Tornado, Blue Ocean Strategy, The Innovator's Solution,
 *     Positioning and 7 Powers — all business strategy;
 *   · Steve Jobs is 5★, Titan is 4★, and American Prometheus is explicitly
 *     position 3 of the 17-book to-read shelf;
 *   · every rating in the drawer is the export's own star value;
 *   · Sicario is a five-star hearted film in the Letterboxd set.
 *
 * No date is asserted anywhere: only 43% of the corpus carries a Date Read
 * (Finding 5), so the screen leans on facts that do not depend on one.
 *
 * The cover art is the one stand-in, and it says so in `Cover.tsx`.
 */

export const metadata: Metadata = {
  title: "Tonight · Nightstand",
};

/** Saved openings for the same engine (PLAN §4.4). The last one is chat. */
const situations = [
  "Background while cooking",
  "Long flight",
  "45 min before bed",
  "Nothing heavy",
  "In theaters now",
  "Something else…",
] as const;

/**
 * The drawer — finished, with what you made of it. Every gradient below is
 * the export's own star value, mapped 5→loved, 4→liked, 3→fine, 1–2→no, and
 * the six run the whole scale rather than stacking identical dots: a strip
 * whose job is to prove your rating is primary has to show a rating that
 * varies. Sicario is the Letterboxd five (Finding 7) — one shelf, two media.
 */
const drawer: ReadonlyArray<{ id: CoverId; rating: Gradient }> = [
  { id: "morgan", rating: "loved" }, // 5★
  { id: "sicario", rating: "loved" }, // 5★, hearted — film
  { id: "titan", rating: "liked" }, // 4★
  { id: "going-infinite", rating: "fine" }, // 3★
  { id: "catch-22", rating: "no" }, // 1★
  { id: "thin-air", rating: "loved" }, // 5★
];

const strokeIcon = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const tabBarItems: readonly TabBarItem[] = [
  {
    href: "/tonight",
    label: "Tonight",
    current: true,
    icon: (
      <svg viewBox="0 0 24 24" {...strokeIcon}>
        <path d="M20.8 13.2A8.5 8.5 0 1 1 10.8 3.2a7 7 0 0 0 10 10Z" />
      </svg>
    ),
  },
  {
    href: "/library",
    label: "Library",
    icon: (
      <svg viewBox="0 0 24 24" {...strokeIcon}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z" />
        <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
      </svg>
    ),
  },
  {
    href: "/stack",
    label: "The stack",
    icon: (
      <svg viewBox="0 0 24 24" {...strokeIcon}>
        <path d="M12 3 3 8l9 5 9-5-9-5Z" />
        <path d="m3 13 9 5 9-5" />
      </svg>
    ),
  },
  {
    href: "/search",
    label: "Search",
    icon: (
      <svg viewBox="0 0 24 24" {...strokeIcon}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m20.5 20.5-4.9-4.9" />
      </svg>
    ),
  },
];

export default function StyleTilePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-lg flex-1 px-6 pt-10 pb-14">
        {/* No weekday eyebrow: a hardcoded "Tuesday night" is a placeholder
            tell six days out of seven, and a real clock would be the only
            thing on the screen not drawn from the corpus. */}
        <header className="flex flex-col gap-3">
          <h1 className="font-display text-3xl font-semibold text-balance">
            Something long tonight?
          </h1>
          <p className="text-base text-fg-muted">
            The last five books you added to the stack are all business
            strategy. Here&rsquo;s one with a person in it.
          </p>
        </header>

        <section aria-label="Tonight's hand" className="mt-8 flex flex-col gap-4">
          <p className="text-xs font-semibold tracking-[0.14em] text-fg-muted uppercase">
            First of four
          </p>
          <HeroRec />
          <div className="flex justify-center">
            <Button variant="ghost">See the other three</Button>
          </div>
        </section>

        <section className="mt-12 flex flex-col gap-4">
          <h2 className="font-display text-xl font-semibold">
            Or say what tonight looks like
          </h2>
          <ul className="flex flex-wrap gap-2">
            {situations.map((situation) => (
              <li key={situation} className="flex">
                <Chip>{situation}</Chip>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-xl font-semibold">The drawer</h2>
            <Button variant="ghost" className="-mr-5 px-5 text-sm">
              All 199
            </Button>
          </div>
          <p className="text-sm text-fg-muted">
            Your rating first — books and films on one shelf.
          </p>
          {/* Bleeds to both edges so the strip reads as scrollable without a
              scrollbar, a rule, or a chevron. */}
          <ul className="-mx-6 mt-4 flex gap-4 overflow-x-auto px-6 pb-2">
            {drawer.map(({ id, rating }) => {
              const art = coverArt[id];
              return (
                <li key={id} className="shrink-0">
                  <a
                    href="#"
                    aria-label={`${art.title} ${art.credit} ${art.author} — ${ratingPhrase[rating]}`}
                    className={cx(
                      "block w-28 rounded-sm",
                      focusRing,
                      // The ring clears the artwork rather than sitting on it.
                      "focus-visible:outline-offset-4",
                    )}
                  >
                    <Cover id={id} />
                    <span className="mt-2.5 flex">
                      <RatingDots rating={rating} />
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      <TabBar items={tabBarItems} />
    </div>
  );
}
