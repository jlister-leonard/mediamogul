/**
 * Contrast math over the registry's brand colors (E5.3).
 *
 * A brand's colors are external facts we do not repaint (see the retained-mark
 * constraints in `public/brands/BRANDS.md`), so this file does not
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
 * The measured facts, all 14 entries, foreground on background:
 *
 *   below 4.5:1 — Netflix 4.38:1, Fandango 2.73:1, Overcast 2.58:1
 *   above 4.5:1 — everything else
 *
 * dissolves into warm ink  (dark)  — Netflix, HBO Max, Prime Video, Apple TV+, Peacock,
 *                                    Disney+, Kindle
 * dissolves into warm paper (light) — Hulu, Spotify, Audible, Bookshop.org,
 *                                     Fandango, Overcast
 *
 * COLOR-LITERAL NOTE: E0.2's discipline is zero raw hex outside
 * `styles/tokens.css` (plus `lib/providers/registry.ts`, sanctioned there for
 * brand facts). This file adds no new color to the system. The only colors it
 * EMITS are the CSS keywords `white` and `black` — the poles of the sRGB range,
 * chosen by measurement rather than as palette choices, and their luminances
 * are exactly 1 and 0, so even the math needs no literals. Every color it reads
 * arrives as data from the registry. Hex appears below only inside prose and in
 * `#RRGGBB` format descriptions, never as a value the code uses.
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
   * The color Nightstand-owned TEXT on the button takes — the optional suffix
   * and the wordmark fallback used only for a future entry without an asset.
   *
   * It is the brand's own foreground whenever the brand's published pair clears
   * AA. Netflix red on black (4.38:1), plus Fandango and Overcast white on
   * orange (2.73:1 and 2.58:1), use the sRGB pole
   * that reads on that field.
   *
   * Fandango and Overcast use exact-casing text fallbacks recorded in
   * BRANDS.md. This keeps any adjacent price
   * or action text at the same readable pole without filtering the asset.
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
