import type { ProviderEntry } from "@/lib/providers/registry";
import { cx, focusRing } from "@/components/ui/util";
import { brandTreatment } from "./brand";
import { providerWebUrl, type ProviderLinkArgs } from "./link";

interface ProviderButtonBaseProps {
  /** Any entry from `lib/providers/registry.ts` — the single source of truth. */
  provider: ProviderEntry;
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
 * Prefer a provider-resolved title URL when availability data supplies one.
 * The generic registry link remains the honest fallback for catalog-only
 * items. Making the two forms mutually exclusive prevents a caller from
 * accidentally supplying a direct URL that is silently ignored.
 */
export type ProviderButtonProps = ProviderButtonBaseProps &
  (
    | { href: string; link?: never }
    | { href?: never; link: ProviderLinkArgs }
  );

/**
 * The most-tapped element in the app: one branded handoff to one service.
 *
 * A provider button uses a verified local mark only when its official context
 * is established; otherwise it uses exact-casing text, not guessed logo art.
 * Everything Nightstand controls
 * is held constant so a row of them reads as one row and not as a strip of ads:
 * one height, one radius (the house pill from `components/ui`), one type scale,
 * one focus ring. The brand color is contained inside the pill and never leaks
 * into the surrounding warm UI.
 *
 * TWO RENDER BRANCHES, ONE ACCESSIBLE NAME. While `logoAsset` is null the
 * button renders the entry's `wordmark` in its exact official casing (NETFLIX,
 * hulu, prime video) set in the interface sans — never Fraunces, the display
 * serif: faux brand lettering is worse than plain lettering. The wordmark is
 * marked `role="img"` because that is what it is — a stand-in for logo art. The
 * moment an official asset's use context is verified and `logoAsset` is set, the `<img>`
 * branch takes over with the identical accessible name and no component change
 * (see `public/brands/BRANDS.md`).
 *
 * NO RE-TINTING. Retained marks follow their published treatment, so there is no
 * hover opacity or brightness shift here — the brand field is the published
 * color at rest, on hover, and while pressed. The affordance is motion instead.
 *
 * The one published color not painted verbatim is Nightstand-owned TEXT for
 * entries whose registry pair is below AA. Two
 * separate things are true and it is worth keeping them apart: WCAG 1.4.3
 * exempts text that is part of a logo or brand name from contrast minimums, so
 * rendering those pairs as published would not be a *compliance* failure — and
 * that exemption is why nobody is forced to touch them. We recolor the text
 * anyway because it is unreadable at 2.6:1, and because the bar this bead was
 * held to is a clean axe run on the demo page, which the exemption does not buy
 * (axe flags logotype text like any other text — measured). `brandTreatment`
 * carries the reasoning; the brand FIELD stays exact either way.
 *
 * DESTINATION-SCOPED. Exact availability URLs win. Otherwise the registry
 * supplies either a verified search destination or an honest service homepage;
 * this component never upgrades an ordinary HTTPS fallback into a universal-
 * link claim.
 */
export function ProviderButton({
  provider,
  href,
  link,
  suffix,
  className,
}: ProviderButtonProps) {
  const treatment = brandTreatment(provider.brand);
  const destination =
    href === undefined ? providerWebUrl(provider, link) : safeHref(provider, href);

  return (
    <a
      href={destination}
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
        // ≥44px tap target with room to spare: 48px tall, 20px of side padding.
        // The asset-specific reviewed height is recorded in the registry; the
        // pill supplies at least 11.5px vertically and 20px horizontally. The
        // wordmark fallback retains the same pill geometry for
        // a future registry entry whose reviewed asset has not landed yet.
        "inline-flex min-h-12 items-center gap-2.5 rounded-full px-5",
        "transition-transform duration-150 motion-reduce:transition-none",
        // Under reduced motion the transition is suppressed, which would turn
        // the eased 2% grow into an instant snap — harsher than what it
        // replaces. So the scale itself is dropped too, not just its easing.
        "hover:scale-[1.02] active:scale-[0.97]",
        "motion-reduce:hover:scale-100 motion-reduce:active:scale-100",
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
        // Reviewed local brand art keeps its intrinsic ratio via `w-auto`.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={provider.logoAsset}
          alt={provider.name}
          style={{ height: `${provider.logoHeightPx ?? 24}px` }}
          className="w-auto"
        />
      )}
      {suffix !== undefined && (
        <span className="text-sm font-medium whitespace-nowrap">{suffix}</span>
      )}
    </a>
  );
}

/** Availability URLs cross an external-data boundary; reject unsafe schemes. */
function safeHref(provider: ProviderEntry, href: string): string {
  const url = new URL(href);
  if (url.protocol !== "https:") {
    throw new Error(`Provider destinations must use https, received "${url.protocol}"`);
  }
  if (!provider.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error(
      `${provider.name} destinations must use an allowed host, received "${url.hostname}"`,
    );
  }
  return url.toString();
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
