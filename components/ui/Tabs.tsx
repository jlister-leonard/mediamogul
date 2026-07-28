"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx, focusRing } from "./util";

export type TabItem = {
  id: string;
  label: string;
};

type TabsProps = {
  /** Accessible name for the tab list, e.g. "Library sections". */
  label: string;
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Content of the active panel. */
  children: ReactNode;
  className?: string;
};

/**
 * In-content tabs (for the bottom navigation bar, see `TabBar`). Underline
 * style: the active tab carries weight and a lamplight bar; the rest recede.
 * Arrow keys move and select (automatic activation); Home/End jump.
 */
export function Tabs({ label, tabs, value, onChange, children, className }: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === value),
  );

  function focusAndSelect(index: number) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    tabRefs.current.get(tab.id)?.focus();
    onChange(tab.id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const handlers: Record<string, () => void> = {
      ArrowRight: () => focusAndSelect(activeIndex + 1),
      ArrowLeft: () => focusAndSelect(activeIndex - 1),
      Home: () => focusAndSelect(0),
      End: () => focusAndSelect(tabs.length - 1),
    };
    const handler = handlers[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  }

  return (
    <div className={className}>
      {/* Longer tab sets scroll horizontally rather than wrapping; the
          negative-margin/padding pair keeps focus rings unclipped. */}
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="-m-1 flex gap-1 overflow-x-auto p-1"
      >
        {tabs.map((tab, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cx(
                "relative min-h-11 rounded-sm px-4 text-sm whitespace-nowrap",
                "transition-[background-color,color] duration-150 motion-reduce:transition-none",
                selected ? "font-semibold text-fg" : "font-medium text-fg-muted hover:text-fg",
                focusRing,
              )}
            >
              {tab.label}
              <span
                aria-hidden
                className={cx(
                  "absolute inset-x-3 bottom-0 h-0.5 rounded-full",
                  "transition-opacity duration-150 motion-reduce:transition-none",
                  selected ? "bg-accent opacity-100" : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${tabs[activeIndex]?.id}`}
        tabIndex={0}
        className={cx("mt-4 rounded-sm", focusRing)}
      >
        {children}
      </div>
    </div>
  );
}
