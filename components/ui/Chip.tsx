import type { ComponentProps } from "react";
import { cx, focusRing } from "./util";

type ChipProps = ComponentProps<"button"> & {
  /**
   * When provided, the chip is a toggle (taste tags, filters) and exposes
   * `aria-pressed`. Leave undefined for a plain one-shot chip action.
   */
  selected?: boolean;
};

/**
 * A small labelled action — taste tags, context tags, filters. Full 44px
 * tap target; selection is shown by lamplight, not by a border.
 */
export function Chip({ selected, type = "button", className, ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium",
        "transition-[transform,background-color,color] duration-150 motion-reduce:transition-none",
        "active:scale-[0.97]",
        selected
          ? "bg-accent text-accent-fg"
          : "bg-surface text-fg hover:bg-overlay",
        focusRing,
        className,
      )}
      {...rest}
    />
  );
}
