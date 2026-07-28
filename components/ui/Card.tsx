import type { HTMLAttributes, Ref } from "react";
import { cx } from "./util";

type CardProps = HTMLAttributes<HTMLElement> & {
  ref?: Ref<HTMLElement>;
  /** Semantic element to render — `article` for items, `section` for groups. */
  as?: "div" | "article" | "section" | "li" | "figure";
  /** Set false when the content manages its own edges (e.g. full-bleed art). */
  padded?: boolean;
};

/**
 * A raised surface. One step up from the ground, separated by tone and
 * space — not by a border. Art-forward content should sit flush
 * (`padded={false}`) so covers reach the card's edge.
 */
export function Card({ as: Tag = "div", padded = true, className, ref, ...rest }: CardProps) {
  return (
    <Tag
      // The tag union makes React demand an intersection of per-element ref
      // types no single Ref satisfies. Every allowed tag is an HTMLElement,
      // so accepting Ref<HTMLElement> and narrowing here is safe.
      ref={ref as never}
      className={cx(
        "overflow-hidden rounded-lg bg-surface text-fg",
        padded && "p-5",
        className,
      )}
      {...rest}
    />
  );
}
