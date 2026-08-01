import { GetItRow, ProviderButton, brandTreatment } from "@/components/provider-button";
import {
  providerEntries,
  providerRegistry,
  type ProviderEntry,
} from "@/lib/providers/registry";
import type { ProviderLinkArgs } from "@/components/provider-button";

/**
 * E5.3 development surface. Not a product route: it exists so the branded
 * buttons can be looked at in both themes, so every registry entry is proved to
 * render, and so the axe/tap-target/casing e2e checks have one page to scan.
 * The real rows are assembled by E5.5 on detail pages and rec cards.
 */

const MOVIE = "Dune: Part Two";
const BOOK = { title: "The Overstory", author: "Richard Powers", isbn13: "9780393635522" };
const SHOW_SPOTIFY = "4rOoJ6Egrf8K2IrywzwOMk";
const SHOW_APPLE = 1200361736;

/** Realistic arguments for every entry, so all 15 render for real. */
function sampleLink(entry: ProviderEntry): ProviderLinkArgs {
  switch (entry.deepLink.params) {
    case "title":
      return { params: "title", title: MOVIE };
    case "book":
      return { params: "book", ...BOOK };
    case "showtimes":
      return { params: "showtimes", title: MOVIE, zip: "94110" };
    case "spotifyShow":
      return { params: "spotifyShow", spotifyShowId: SHOW_SPOTIFY };
    case "applePodcast":
      return { params: "applePodcast", appleId: SHOW_APPLE };
  }
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <p className="text-sm text-fg-muted">{note}</p>
      </header>
      {children}
    </section>
  );
}

export default function ProvidersDemoPage() {
  return (
    <main className="mx-auto w-full max-w-lg px-6 pt-12 pb-16">
      <p className="mb-8 rounded-md bg-surface px-4 py-3 text-sm text-fg-muted">
        <strong className="font-semibold text-fg">Development surface.</strong>{" "}
        Not part of the product — E5.3 renders every provider button here so it
        can be judged in both themes. Dark is the default; switch your system to
        light to see warm paper.
      </p>

      <header className="mb-12 flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold">Provider buttons</h1>
        <p className="text-base text-fg-muted">
          One component renders any entry in the provider registry. A direct
          provider URL wins when availability data has one; otherwise the
          button uses a verified search or honest service-home fallback.
        </p>
      </header>

      <div className="flex flex-col gap-14">
        <Section
          title="The row"
          note="A get-it row for one movie, one book, one podcast. Each array arrives already ordered — the row never sorts."
        >
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-fg-muted">{MOVIE}</h3>
            <GetItRow
              label={`Get ${MOVIE}`}
              items={[
                { provider: providerRegistry["hbo-max"], link: { params: "title", title: MOVIE } },
                { provider: providerRegistry["prime-video"], link: { params: "title", title: MOVIE }, suffix: "rent $3.99" },
                { provider: providerRegistry["apple-tv-plus"], link: { params: "title", title: MOVIE }, suffix: "buy $19.99" },
                { provider: providerRegistry.fandango, link: { params: "showtimes", title: MOVIE, zip: "94110" }, suffix: "showtimes" },
              ]}
            />
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-fg-muted">
              {BOOK.title}
            </h3>
            <GetItRow
              label={`Get ${BOOK.title}`}
              items={[
                { provider: providerRegistry.kindle, link: { params: "book", ...BOOK }, suffix: "$12.99" },
                { provider: providerRegistry.audible, link: { params: "book", ...BOOK } },
                { provider: providerRegistry.bookshop, link: { params: "book", ...BOOK } },
              ]}
            />
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-fg-muted">
              The Daily
            </h3>
            <GetItRow
              label="Get The Daily"
              items={[
                { provider: providerRegistry.spotify, link: { params: "spotifyShow", spotifyShowId: SHOW_SPOTIFY } },
                { provider: providerRegistry["apple-podcasts"], link: { params: "applePodcast", appleId: SHOW_APPLE } },
                { provider: providerRegistry.overcast, link: { params: "applePodcast", appleId: SHOW_APPLE } },
              ]}
            />
          </div>
        </Section>

        <Section
          title="Every service"
          note="All 15 registry entries. Four use reviewed official local assets; the rest use exact-casing text until a sanctioned mark and its display rules are established. Nothing is fetched at runtime."
        >
          <ul className="flex flex-wrap gap-3">
            {providerEntries.map((entry) => (
              <li key={entry.id}>
                <ProviderButton provider={entry} link={sampleLink(entry)} />
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="What the brand facts force"
          note="Measured from the registry, not decided here. Text falls back to a readable pole where a brand's own pair is below 4.5:1; a field that drops under 3:1 against the page ground gets a hairline in that theme."
        >
          <div
            tabIndex={0}
            role="region"
            aria-label="Brand treatment table"
            className="-mx-6 overflow-x-auto px-6"
          >
            <table className="w-max text-left text-sm">
              <thead className="text-fg-muted">
                <tr>
                  <th scope="col" className="py-2 pr-6 font-medium">Service</th>
                  <th scope="col" className="py-2 pr-6 font-medium">Brand pair</th>
                  <th scope="col" className="py-2 pr-6 font-medium">Text</th>
                  <th scope="col" className="py-2 font-medium">Hairline</th>
                </tr>
              </thead>
              <tbody>
                {providerEntries.map((entry) => {
                  const t = brandTreatment(entry.brand);
                  const hairline = [
                    t.hairlineInDark && "dark",
                    t.hairlineInLight && "light",
                  ]
                    .filter(Boolean)
                    .join(" + ");
                  return (
                    <tr key={entry.id} className="border-t border-line">
                      <th scope="row" className="py-2 pr-6 font-medium">
                        {entry.name}
                      </th>
                      <td className="py-2 pr-6 tabular-nums">
                        {t.pairRatio.toFixed(2)}:1
                        {t.pairRatio < 4.5 && (
                          <span className="text-fg-muted"> · below AA</span>
                        )}
                      </td>
                      <td className="py-2 pr-6">
                        {t.textColor === entry.brand.foreground
                          ? "brand"
                          : t.textColor}
                      </td>
                      <td className="py-2">{hairline || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-fg-muted">
            Fandango and Overcast&rsquo;s recorded white-on-orange pairs measure
            2.73:1 and 2.58:1. Their exact-casing fallbacks and Nightstand-owned suffix
            text use the readable black treatment documented in BRANDS.md; the
            recognizable orange fields remain untouched.
          </p>
        </Section>
      </div>
    </main>
  );
}
