"use client";

import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { cx, focusRing } from "./util";

type SheetProps = {
  open: boolean;
  /** Called on any dismissal: close button, Escape, or backdrop tap. */
  onClose: () => void;
  /** Names the sheet for assistive tech and renders as its heading. */
  title: string;
  children: ReactNode;
};

/**
 * A bottom sheet on the native `<dialog>` element — real focus trap, real
 * Escape handling, top layer, for free. Rises from the bottom edge (transform
 * + opacity only, skipped under reduced motion), respects
 * `safe-area-inset-bottom`, and dims the room behind it with an ink scrim.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    // Clicks on the sheet's own content target descendants; only a click on
    // the backdrop targets the dialog element itself.
    if (event.target === ref.current) onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={onBackdropClick}
      className={cx(
        "fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none p-0",
        "rounded-t-xl bg-overlay text-fg",
        "max-h-[85dvh] overflow-y-auto overscroll-contain",
        "backdrop:bg-ink/55",
        // Entry rises; exit is deliberately instant. Dismissal is a decision
        // already made — the sheet gets out of the way at once, and the
        // allow-discrete display/overlay choreography an exit transition
        // needs isn't worth its weight.
        "motion-safe:transition-[transform,opacity] motion-safe:duration-200 motion-safe:ease-out",
        "starting:translate-y-8 starting:opacity-0",
      )}
    >
      <div className="mx-auto max-w-lg px-6 pt-3 pb-[calc(--spacing(6)+env(safe-area-inset-bottom))]">
        <div aria-hidden className="mx-auto mb-4 h-1 w-9 rounded-full bg-line" />
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-xl font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cx(
              "-mt-1.5 -mr-2.5 grid size-11 shrink-0 place-items-center rounded-full text-fg-muted",
              "transition-[background-color,color] duration-150 hover:bg-surface hover:text-fg motion-reduce:transition-none",
              focusRing,
            )}
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
