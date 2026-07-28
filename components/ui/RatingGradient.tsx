"use client";

import { useRef, type KeyboardEvent } from "react";
import { cx, focusRing } from "./util";

export type RatingValue = "loved" | "liked" | "fine" | "no";

type RatingGradientProps = {
  /** Accessible name for the group, e.g. "Rate The Overstory". */
  label: string;
  value: RatingValue | null;
  /** Tapping the selected step again clears it (`null`). */
  onChange: (value: RatingValue | null) => void;
  className?: string;
};

/**
 * The four-step rating: loved / liked / fine / no. One tap each, full-width
 * so every step is thumb-reachable, with the lamplight fading step by step —
 * the gradient is the scale. Radio semantics: arrow keys move and select;
 * tapping the current choice takes it back.
 */
const steps: ReadonlyArray<{ value: RatingValue; label: string; dot: string }> = [
  { value: "loved", label: "Loved", dot: "bg-accent" },
  { value: "liked", label: "Liked", dot: "bg-accent/70" },
  { value: "fine", label: "Fine", dot: "bg-accent/40" },
  { value: "no", label: "No", dot: "border border-fg-muted" },
];

export function RatingGradient({ label, value, onChange, className }: RatingGradientProps) {
  const stepRefs = useRef(new Map<RatingValue, HTMLButtonElement>());
  const focusIndex = Math.max(
    0,
    steps.findIndex((step) => step.value === value),
  );

  function moveTo(index: number) {
    const step = steps[(index + steps.length) % steps.length];
    stepRefs.current.get(step.value)?.focus();
    onChange(step.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const handlers: Record<string, () => void> = {
      ArrowRight: () => moveTo(focusIndex + 1),
      ArrowDown: () => moveTo(focusIndex + 1),
      ArrowLeft: () => moveTo(focusIndex - 1),
      ArrowUp: () => moveTo(focusIndex - 1),
      Home: () => moveTo(0),
      End: () => moveTo(steps.length - 1),
    };
    const handler = handlers[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx("flex w-full gap-1 rounded-full bg-surface p-1", className)}
    >
      {steps.map((step, index) => {
        const selected = value === step.value;
        return (
          <button
            key={step.value}
            ref={(node) => {
              if (node) stepRefs.current.set(step.value, node);
              else stepRefs.current.delete(step.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onChange(selected ? null : step.value)}
            className={cx(
              "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-full",
              "text-sm transition-[transform,background-color,color] duration-150 motion-reduce:transition-none",
              "active:scale-[0.97]",
              selected
                ? "bg-accent font-semibold text-accent-fg"
                : "font-medium text-fg-muted hover:text-fg",
              focusRing,
            )}
          >
            <span
              aria-hidden
              className={cx(
                "size-2 rounded-full",
                selected
                  ? step.value === "no"
                    ? "border border-accent-fg"
                    : "bg-accent-fg"
                  : step.dot,
              )}
            />
            {step.label}
          </button>
        );
      })}
    </div>
  );
}
