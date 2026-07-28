"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx, focusRing } from "./util";

export type TabBarItem = {
  href: string;
  label: string;
  /** A 24px stroke icon (`stroke="currentColor"`); inherits the item color. */
  icon: ReactNode;
  /** Override the pathname match, e.g. to keep a tab lit across sub-routes. */
  current?: boolean;
};

type TabBarProps = {
  items: readonly TabBarItem[];
  className?: string;
};

/**
 * The app's bottom navigation. Sticky, not floating: it sits in normal flow
 * at the end of the page column (`flex min-h-dvh flex-col` with the content
 * as `flex-1`), so it can never occlude content — no cover ever gets cut off
 * behind it — while staying pinned to the viewport bottom during scroll.
 * Pads itself below with `safe-area-inset-bottom` for home-indicator phones.
 */
export function TabBar({ items, className }: TabBarProps) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className={cx(
        "sticky bottom-0 z-10 border-t border-line bg-surface/90 backdrop-blur-md",
        "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const current = item.current ?? pathname === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-sm px-2 py-2",
                  "text-xs font-medium transition-[color] duration-150 motion-reduce:transition-none",
                  current ? "text-accent" : "text-fg-muted hover:text-fg",
                  focusRing,
                )}
              >
                <span aria-hidden className="[&>svg]:size-6">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
