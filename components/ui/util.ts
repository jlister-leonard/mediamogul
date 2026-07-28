/**
 * Shared helpers for the primitive set. Internal to `components/ui`.
 */

/** Join class fragments, dropping falsy values. */
export function cx(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * The one focus treatment every interactive primitive shares: a 2px accent
 * ring, offset so it reads against any surface. Keyboard-only by design
 * (`:focus-visible`); never the browser-default blue.
 */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent";
