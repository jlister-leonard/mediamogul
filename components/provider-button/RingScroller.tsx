"use client";

import type { ReactNode } from "react";

/**
 * The scroll container under GetItRow, and the one reason it needs a client
 * boundary.
 *
 * Chromium's focus-driven scrolling calls `ScrollRectToVisible` on the focused
 * element's border box and honors NEITHER `scroll-margin` on the item nor
 * `scroll-padding` on the scrollport. Measured on this row at 390px, focusing
 * the pill that rests 1px inside the clip edge:
 *
 *   browser focus scroll, scroll-margin-inline: 16px  → 0px scrolled, ring sliced
 *   browser focus scroll, scroll-padding-inline: 16px → 0px scrolled, ring sliced
 *   explicit scrollIntoView, scroll-margin only       → 1px of slack, still sliced
 *   explicit scrollIntoView, scroll-padding only      → 16px of slack, ring clear
 *
 * So the fix is not a CSS property the browser was going to read on its own:
 * it is the explicit call, and `scroll-padding` on the scrollport is the knob
 * that call actually respects. Chromium additionally declines to scroll a
 * *partially* visible item at all, which left the last pill of an overflowing
 * row unreachable by tabbing; the same explicit call fixes that too.
 *
 * `focusin` bubbles to here, so one handler covers the row, and the call is a
 * no-op whenever the element is already resting clear of the scroll padding.
 * Only `className` and `children` cross the boundary — the ProviderButtons are
 * rendered by the server component that owns this, so the registry entries
 * (which carry deep-link *functions*) never have to be serialized.
 */
export function RingScroller({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className}
      onFocus={(event) =>
        event.target.scrollIntoView({ inline: "nearest", block: "nearest" })
      }
    >
      {children}
    </div>
  );
}
