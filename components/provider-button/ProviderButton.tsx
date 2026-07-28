import type { ProviderEntry } from "@/lib/providers/registry";
import { cx, focusRing } from "@/components/ui/util";
import { brandTreatment } from "./brand";
import { providerWebUrl, type ProviderLinkArgs } from "./link";

export interface ProviderButtonProps {
  /** Any entry from `lib/providers/registry.ts` — the single source of truth. */
  provider: ProviderEntry;
  /** Link arguments, tagged with the entry's `deepLink.params` discriminant. */
  link: ProviderLinkArgs;
  /**
   * Optional trailing detail — "rent $3.99", "showtimes". Set in Nightstand's
   * own type and weight so it reads as ours rather than as part of the mark,
   * and colored to clear AA on the brand field even where the brand's own
   * published pair does not.
   */
  suffix?: string;
  className?: string;
}

/**
 * The most-tapped element in the app: one branded handoff to one service.
 *
 * A Netflix button is white NETFLIX on Netflix red — instantly the real thing,
 * not a grey chip that says "Netflix" (PLAN §5). Everything Nightstand controls
 * is held constant so a row of them reads as one row and not as a strip of ads:
 * one height, one radius (the house pill from `components/ui`), one type scale,
 * one focus ring. The brand color is contained inside the pill and never leaks
 * into the surrounding warm UI.
 *
 * TWO RENDER BRANCHES, ONE ACCESSIBLE NAME. While `logoAsset` is null the
 * button renders the entry's `wordmark` in its exact official casing (NETFLIX,
 * hulu, prime video) set in the interface sans — never Fraunces, the display
 * serif: faux brand lettering is worse than plain lettering. The wordmark is
 * marked `role="img"` because that is what it is — a stand-in for logo art, and
 * WCAG 1.4.3 exempts text that is part of a logo or brand name from contrast
 * minimums. The moment a kit SVG lands in `public/brands/` and `logoAsset` is
 * set, the `<img>` branch takes over with the identical accessible name and no
 * component change (see `public/brands/BRANDS.md`).
 *
 * NO RE-TINTING. Every brand kit forbids recoloring the mark, so there is no
 * hover opacity or brightness shift here — the brand field is the published
 * color at rest, on hover, and while pressed. The affordance is motion instead.
 * The one place a published color is not painted verbatim is the text color of
 * the two entries whose own pair is below AA; `brandTreatment` documents why
 * and the field itself is still exact.
 *
 * SEARCH-SCOPED. Streaming links land on the provider's search results for the
 * title, not on the title's page — Nightstand holds no provider-internal title
 * ids (registry header). Nothing in this component's labelling implies
 * otherwise; the button says only whose door it opens.
 */
export function ProviderButton({
  provider,
  link,
  suffix,
  className,
}: ProviderButtonProps) {
  const treatment = brandTreatment(provider.brand);

  return (
    <a
      href={providerWebUrl(provider, link)}
      // Leaving Nightstand must never replace Nightstand: from an installed PWA
      // a same-window hop to another origin strands the user outside the app.
      // `noreferrer` also keeps which title you are looking at out of the
      // provider's referrer log — the same instinct as PLAN §5's clean,
      // affiliate-free links.
      target="_blank"
      rel="noopener noreferrer"
      data-provider={provider.id}
      style={{
        backgroundColor: provider.brand.background,
        color: treatment.textColor,
      }}
      className={cx(
        // ≥44px tap target, with room to spare: 48px tall, and 20px of side
        // padding — at least half the 24px mark height on every edge, which is
        // the clear-space rule every kit in BRANDS.md states some variant of.
        "inline-flex min-h-12 items-center gap-2.5 rounded-full px-5",
        "transition-transform duration-150 motion-reduce:transition-none",
        "hover:scale-[1.02] active:scale-[0.97]",
        hairlineClasses(treatment),
        focusRing,
        className,
      )}
    >
      {provider.logoAsset === null ? (
        <span
          role="img"
          aria-label={provider.name}
          className="font-sans text-lg font-semibold whitespace-nowrap"
        >
          {provider.wordmark}
        </span>
      ) : (
        // Brand SVGs are fixed local vector art: `next/image` does not optimize
        // SVG, and `w-auto` is what keeps the mark from being stretched.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={provider.logoAsset}
          alt={provider.name}
          // 24px clears every published minimum size in BRANDS.md (Spotify's
          // 21px digital minimum is the strictest).
          className="h-6 w-auto"
        />
      )}
      {suffix !== undefined && (
        <span className="text-sm font-medium whitespace-nowrap">{suffix}</span>
      )}
    </a>
  );
}

/**
 * A hairline for brand fields that dissolve into the page ground — white
 * Bookshop.org on warm paper, black HBO Max on warm ink. Drawn as a ring
 * (box-shadow), not a border, for two reasons: it composites against the
 * ground rather than against the brand field underneath it, and it costs no
 * layout, so every button in a row is exactly the same size whether or not it
 * has one. The ring color is the app's own muted foreground, so the fix reads
 * as Nightstand's, not as a change to the brand.
 */
function hairlineClasses({
  hairlineInDark,
  hairlineInLight,
}: ReturnType<typeof brandTreatment>): string | false {
  if (hairlineInDark && hairlineInLight) return "ring-1 ring-fg-muted/55";
  if (hairlineInDark) return "ring-0 ring-fg-muted/55 dark:ring-1";
  if (hairlineInLight) return "ring-1 ring-fg-muted/55 dark:ring-0";
  return false;
}
