import type { ComponentProps } from "react";
import { cx, focusRing } from "./util";

type ButtonProps = ComponentProps<"button"> & {
  /**
   * `primary` — the lamp-lit main action; at most one per view.
   * `quiet` — raised-surface secondary action.
   * `ghost` — bare text action; separation by weight, not a box.
   */
  variant?: "primary" | "quiet" | "ghost";
  size?: "md" | "lg";
};

const variants = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  quiet: "bg-surface text-fg hover:bg-overlay",
  ghost: "bg-transparent text-fg hover:bg-surface",
} as const;

const sizes = {
  md: "min-h-11 px-5 text-base",
  lg: "min-h-14 px-7 text-lg",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium",
        "transition-[transform,opacity,background-color,color] duration-150 motion-reduce:transition-none",
        "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        sizes[size],
        focusRing,
        className,
      )}
      {...rest}
    />
  );
}
