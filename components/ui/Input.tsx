"use client";

import { useId, type ComponentProps } from "react";
import { cx, focusRing } from "./util";

type InputProps = Omit<ComponentProps<"input">, "id" | "aria-describedby" | "className"> & {
  /** Always visible — never a placeholder doing a label's job. */
  label: string;
  /** Optional helper line below the field. */
  hint?: string;
  /** Applied to the wrapper: label, field, and hint move as one block. */
  className?: string;
};

/**
 * A labelled text field. 44px tap target, raised surface, no border —
 * the field reads as a place to write, the focus ring says you're in it.
 */
export function Input({ label, hint, className, ...rest }: InputProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className={cx(
          "min-h-11 w-full rounded-md bg-surface px-4 text-base text-fg",
          "placeholder:text-fg-muted disabled:opacity-45",
          focusRing,
        )}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
