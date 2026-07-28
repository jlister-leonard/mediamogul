/**
 * Contrast math over the registry's brand colors (E5.3).
 *
 * A brand's colors are external facts we may not repaint (every kit in
 * `public/brands/BRANDS.md` forbids recoloring the mark), so this file does not
 * *fix* brand colors — it measures them and decides the two things Nightstand
 * is free to decide:
 *
 *   1. what color OUR text (the suffix slot — "rent $3.99") takes, so it never
 *      inherits a brand pair that fails AA; and
 *   2. whether the brand field needs a hairline to hold its edge against the
 *      page ground in a given theme.
 *
 * Both answers are derived from the registry values, so a new provider entry
 * gets the right treatment with no code change here.
 *
 * The measured facts, all 15 entries, foreground on background:
 *
 *   below 4.5:1 — Fandango 2.73:1, Overcast 2.58:1 (both "observed" grade)
 *   above 4.5:1 — everything else, from Netflix 4.79:1 up to 21:1
 *
 * dissolves into warm ink  (dark)  — HBO Max, Prime Video, Apple TV+, Peacock,
 *                                    Disney+, Kindle, Apple Podcasts
 * dissolves into warm paper (light) — Hulu, Spotify, Audible, Bookshop.org,
 *                                     Fandango, Overcast
 *
 * COLOR-LITERAL NOTE: E0.2's discipline is zero raw hex outside
 * `styles/tokens.css` (plus `lib/providers/registry.ts`, sanctioned there for
 * brand facts). This file adds none: the only colors it emits are the CSS
 * keywords `white` and `black`, chosen by measurement as the poles of the sRGB
 * range — not palette choices — and their luminances are exactly 1 and 0, so
 * even the math needs no literals. Every other color it touches comes in as
 * data from the registry.
 */

import type { BrandColors } from "@/lib/providers/registry";

/** WCAG 2.1 AA for normal-size text. */
const AA_NORMAL_TEXT = 4.5;

/**
 * Luminance bands where a brand field drops below 3:1 against the theme ground
 * and visually dissolves into the page — Bookshop.org's white on warm paper,
 * HBO Max / Apple TV+ / Peacock's black and Prime Video's #0F171E on warm ink.
 *
 * 3:1 is WCAG 1.4.11's number for the visual boundary of a UI component; the
 * grounds are `--ground` from `styles/tokens.css` (ink L=0.006853 in dark,
 * paper L=0.844445 in light), so the bands solve to:
 *   dark:  L < 3·(0.006853 + 0.05) − 0.05
 *   light: L > (0.844445 + 0.05) / 3 − 0.05
 * Recompute these two numbers if `--color-ink` or `--color-paper` ever moves.
 */
const DISSOLVES_ON_INK_BELOW = 0.120559;
const DISSOLVES_ON_PAPER_ABOVE = 0.248148;

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#RRGGBB` string (the registry's HexColor shape). */
export function relativeLuminance(hex: string): number {
  return (
    0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
  );
}

/** WCAG contrast ratio between two `#RRGGBB` strings, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (high + 0.05) / (low + 0.05);
}

export interface BrandTreatment {
  /** Contrast of the brand's own published foreground on its background. */
  pairRatio: number;
  /**
   * The color every piece of TEXT on the button takes — the wordmark stand-in
   * and the suffix alike, so a button is never two colors.
   *
   * It is the brand's own foreground whenever the brand's published pair clears
   * AA, which is 13 of the 15 entries. Fandango and Overcast publish white on
   * orange at 2.73:1 and 2.58:1, and there the text falls back to the sRGB pole
   * that reads on that field. Nothing about the brand is repainted by this: the
   * FIELD — Fandango orange — is the recognition cue and stays exact, and what
   * changes color is a text stand-in that exists only because we hold no art
   * for these two (`public/brands/BRANDS.md`). A stand-in nobody can read is
   * not more faithful, just less usable; and the moment a kit SVG lands, the
   * mark renders exactly as published, because an image is not text.
   */
  textColor: string;
  /** The brand field dissolves into the dark (ink) ground; draw a hairline there. */
  hairlineInDark: boolean;
  /** The brand field dissolves into the light (paper) ground; draw a hairline there. */
  hairlineInLight: boolean;
}

export function brandTreatment(brand: BrandColors): BrandTreatment {
  const backgroundLuminance = relativeLuminance(brand.background);
  const pairRatio = contrastRatio(brand.foreground, brand.background);
  // Contrast against the sRGB poles, whose luminances are exactly 1 and 0.
  const onWhite = 1.05 / (backgroundLuminance + 0.05);
  const onBlack = (backgroundLuminance + 0.05) / 0.05;

  return {
    pairRatio,
    textColor:
      pairRatio >= AA_NORMAL_TEXT
        ? brand.foreground
        : onWhite >= onBlack
          ? "white"
          : "black",
    hairlineInDark: backgroundLuminance < DISSOLVES_ON_INK_BELOW,
    hairlineInLight: backgroundLuminance > DISSOLVES_ON_PAPER_ABOVE,
  };
}
