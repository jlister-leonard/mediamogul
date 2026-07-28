/**
 * Placeholder cover art for the E0.7 style tile.
 *
 * STAND-INS, DELIBERATELY. No cover image is fetched anywhere in this app
 * yet — egress is blocked in the build environment and hotlinking publisher
 * art is not an option — so each of these six is a pure-CSS composition:
 * a deep color field, the title in Fraunces, the author in letterspaced
 * sans, and one austere structural idea per book (a struck band, a head
 * panel, a horizon, a spine rule, stepped bars, a ruled frame). Penguin
 * discipline, not clip art.
 *
 * They exist so the verdict on this screen is about layout, type, color and
 * proportion rather than about ugly grey boxes. Real artwork arrives with
 * E2.x metadata and every one of these disappears; nothing else on the
 * screen changes when it does, which is the point.
 *
 * Sizing is container-relative (`cqi` units in tile.css), so one component
 * serves the 198px hero and the 112px library strip.
 */

const layouts = {
  band: "ns-art--band",
  classic: "ns-art--classic",
  horizon: "ns-art--horizon",
  rule: "ns-art--rule",
  stack: "ns-art--stack",
  frame: "ns-art--frame",
  poster: "ns-art--poster",
} as const;

type Layout = keyof typeof layouts;

export type CoverId =
  | "prometheus"
  | "morgan"
  | "sicario"
  | "titan"
  | "going-infinite"
  | "catch-22"
  | "thin-air";

export interface CoverArt {
  /** Short title — the subtitle is demoted out of the artwork entirely. */
  title: string;
  /** Exactly as it renders, so an aria-label built from it matches the art. */
  author: string;
  /** How the credit reads in prose: "by" for a book, "directed by" for a film. */
  credit: "by" | "directed by";
  layout: Layout;
}

/**
 * Seven titles, every one of them in the seed corpus: six books from the
 * Goodreads export and one film from the Letterboxd set (TASTE-BASELINE
 * Finding 7). The film is here on purpose — cross-media taste is the wedge
 * PLAN §1 says no incumbent will ever ship, and a shelf that mixes a
 * Villeneuve picture in with two Chernows is the shortest way to show it.
 */
export const coverArt: Readonly<Record<CoverId, CoverArt>> = {
  prometheus: {
    title: "American Prometheus",
    author: "Bird & Sherwin",
    credit: "by",
    layout: "band",
  },
  morgan: {
    title: "The House of Morgan",
    author: "Ron Chernow",
    credit: "by",
    layout: "classic",
  },
  sicario: {
    title: "Sicario",
    author: "Denis Villeneuve",
    credit: "directed by",
    layout: "poster",
  },
  titan: { title: "Titan", author: "Ron Chernow", credit: "by", layout: "rule" },
  "going-infinite": {
    title: "Going Infinite",
    author: "Michael Lewis",
    credit: "by",
    layout: "stack",
  },
  "catch-22": {
    title: "Catch-22",
    author: "Joseph Heller",
    credit: "by",
    layout: "frame",
  },
  "thin-air": {
    title: "Into Thin Air",
    author: "Jon Krakauer",
    credit: "by",
    layout: "horizon",
  },
};

interface CoverProps {
  id: CoverId;
  /** Sizing lives on the caller: the cover fills the width it is given. */
  className?: string;
}

/**
 * Always `aria-hidden`: every place a cover appears, the surrounding link or
 * card already carries the title and author as real text.
 */
export function Cover({ id, className }: CoverProps) {
  const art = coverArt[id];
  const title = <span className="ns-art__title">{art.title}</span>;
  const author = <span className="ns-art__author">{art.author}</span>;

  return (
    <span
      aria-hidden
      className={["ns-art", `ns-art--${id}`, layouts[art.layout], className]
        .filter(Boolean)
        .join(" ")}
    >
      {art.layout === "stack" ? (
        <span className="ns-art__bars">
          <span />
          <span />
          <span />
        </span>
      ) : art.layout === "classic" ? null : (
        <span className="ns-art__rule" />
      )}
      {art.layout === "classic" ? <span className="ns-art__mark" /> : null}
      <span className="ns-art__panel">{title}</span>
      {author}
    </span>
  );
}
