import { providerRegistry, type BookParams, type ProviderEntry } from "@/lib/providers/registry";
import { focusRing } from "@/components/ui/util";

/**
 * The Get-it row, mocked at style-tile fidelity (PLAN §5).
 *
 * Every value here — wordmark casing, brand background, brand foreground,
 * deep link — comes out of `lib/providers/registry.ts`; nothing is retyped.
 * Until official kit SVGs land in `public/brands/`, the registry renders each
 * service as its wordmark in exact official casing on its brand color, which
 * is what E5.3's real `ProviderButton` will do too. This local copy exists
 * only so the tile can show the row without reaching into E5.3's footprint.
 *
 * These buttons are deliberately the one place on the screen where colors
 * come from outside the token system: a Netflix button has to look like
 * Netflix, and an off-brand mark is the fastest way to make the whole app
 * feel homemade.
 */

/**
 * Two up, then one across. BOOKSHOP.ORG is a 12-character wordmark in the
 * brand's own casing — at a third of a 390px screen it overran its box and
 * collided with the corner radius. Shortening the mark is not an option
 * (that is the brand), so the row gives it a full width of its own.
 */
const bookOrder = ["kindle", "audible", "bookshop"] as const;
const fullWidth = new Set(["bookshop"]);

function bookHref(entry: ProviderEntry, book: BookParams): string {
  // `deepLink` is discriminated on `params`; the three book services all
  // carry the book shape, and the fallback keeps this total.
  return entry.deepLink.params === "book" ? entry.deepLink.web(book) : "#";
}

export function GetItRow({ book }: { book: BookParams }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-[0.14em] text-fg-muted uppercase">
        Get it
      </h3>
      <ul className="grid grid-cols-2 gap-2">
        {bookOrder.map((id) => {
          const entry = providerRegistry[id];
          return (
            <li key={id} className={fullWidth.has(id) ? "col-span-2 flex" : "flex"}>
              <a
                href={bookHref(entry, book)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Get ${book.title} on ${entry.name}`}
                style={{
                  backgroundColor: entry.brand.background,
                  color: entry.brand.foreground,
                  // Bookshop.org's brand background is white, which on warm
                  // paper would leave the button with no edge at all. A
                  // hairline of the brand's own foreground gives it one and
                  // is invisible on the dark-grounded marks.
                  boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${entry.brand.foreground} 16%, transparent)`,
                }}
                className={[
                  "inline-flex min-h-11 w-full items-center justify-center rounded-md px-2",
                  "text-center text-xs font-semibold tracking-tight",
                  "transition-transform duration-150 active:scale-[0.97] motion-reduce:transition-none",
                  focusRing,
                ].join(" ")}
              >
                {entry.wordmark}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
