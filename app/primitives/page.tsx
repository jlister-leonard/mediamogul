"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Chip,
  Input,
  RatingGradient,
  Sheet,
  TabBar,
  Tabs,
  type RatingValue,
  type TabBarItem,
} from "@/components/ui";

/**
 * E0.4 demo route: every primitive, every variant and state, both themes
 * (dark is the default; light follows `prefers-color-scheme`). This page is
 * the working surface the E0.7 style tile composes from.
 */

const tasteTags = ["Pacing", "Ending", "Density", "Voice", "World"];

const strokeIcon = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const tabBarItems: readonly TabBarItem[] = [
  {
    href: "/tonight",
    label: "Tonight",
    current: true,
    icon: (
      <svg viewBox="0 0 24 24" {...strokeIcon}>
        <path d="M20.8 13.2A8.5 8.5 0 1 1 10.8 3.2a7 7 0 0 0 10 10Z" />
      </svg>
    ),
  },
  {
    href: "/library",
    label: "Library",
    icon: (
      <svg viewBox="0 0 24 24" {...strokeIcon}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z" />
        <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
      </svg>
    ),
  },
  {
    href: "/stack",
    label: "The stack",
    icon: (
      <svg viewBox="0 0 24 24" {...strokeIcon}>
        <path d="M12 3 3 8l9 5 9-5-9-5Z" />
        <path d="m3 13 9 5 9-5" />
      </svg>
    ),
  },
  {
    href: "/search",
    label: "Search",
    icon: (
      <svg viewBox="0 0 24 24" {...strokeIcon}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m20.5 20.5-4.9-4.9" />
      </svg>
    ),
  },
];

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

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-fg-muted">{children}</p>;
}

export default function PrimitivesPage() {
  const [selectedTags, setSelectedTags] = useState<readonly string[]>(["Ending"]);
  const [tab, setTab] = useState("nightstand");
  const [rating, setRating] = useState<RatingValue | null>(null);
  const [sheetRating, setSheetRating] = useState<RatingValue | null>("loved");
  const [sheetTags, setSheetTags] = useState<readonly string[]>(["Density"]);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-lg flex-1 px-6 pt-12 pb-16">
        <header className="mb-12 flex flex-col gap-2">
          <h1 className="font-display text-3xl font-semibold">Primitives</h1>
          <p className="text-base text-fg-muted">
            Every UI primitive in every variant and state. Dark is the default
            theme; switch your system to light to see warm paper.
          </p>
        </header>

        <div className="flex flex-col gap-14">
          <Section
            title="Button"
            note="Three weights — primary carries the lamp, quiet sits on a surface, ghost is bare text. Two sizes, plus disabled."
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button>Log it</Button>
              <Button variant="quiet">Queue</Button>
              <Button variant="ghost">Not now</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg">Get it</Button>
              <Button variant="quiet" size="lg">
                Borrow
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled>Log it</Button>
              <Button variant="quiet" disabled>
                Queue
              </Button>
              <Button variant="ghost" disabled>
                Not now
              </Button>
            </div>
            <Caption>Rows: default size · large · disabled.</Caption>
          </Section>

          <Section
            title="Chip"
            note="Taste tags and context tags — toggles with a full 44px tap target. Tap to flip them here."
          >
            <div className="flex flex-wrap gap-2">
              {tasteTags.map((tag) => (
                <Chip
                  key={tag}
                  selected={selectedTags.includes(tag)}
                  onClick={() =>
                    setSelectedTags((current) =>
                      current.includes(tag)
                        ? current.filter((t) => t !== tag)
                        : [...current, tag],
                    )
                  }
                >
                  {tag}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip onClick={() => setSelectedTags([])}>Clear tags</Chip>
            </div>
            <Caption>
              First row: toggle chips (selected state is lamplight). Second: a
              plain action chip, no pressed state.
            </Caption>
          </Section>

          <Section
            title="Card"
            note="A raised surface, separated by tone — no borders. Unpadded for art-forward content, padded for text."
          >
            <div className="grid grid-cols-2 gap-4">
              <Card as="article" padded={false}>
                <div
                  aria-hidden
                  className="aspect-2/3 bg-linear-to-b from-accent/45 to-accent/10"
                />
                <div className="p-4">
                  <h3 className="font-display text-lg font-semibold">
                    The House of Morgan
                  </h3>
                  <p className="mt-1 text-sm text-fg-muted">Ron Chernow</p>
                </div>
              </Card>
              <Card as="article">
                <h3 className="font-display text-lg font-semibold">Padded</h3>
                <p className="mt-2 text-sm text-fg-muted">
                  Body copy sits inside generous padding. The cover block on
                  the left is a placeholder for real artwork.
                </p>
              </Card>
            </div>
          </Section>

          <Section
            title="Input"
            note="Always a visible label — the placeholder never does the label's job. Optional hint line; disabled shown."
          >
            <div className="flex flex-col gap-6">
              <Input
                label="Note"
                placeholder="What stayed with you?"
                hint="Saved with the entry. Searchable later."
              />
              <Input label="Title" defaultValue="Inside the Tornado" />
              <Input label="Narrator" placeholder="Audiobook only" disabled />
            </div>
          </Section>

          <Section
            title="Tabs"
            note="In-content tabs. Arrow keys move and select; the active tab carries weight and a lamplight bar. Panel follows."
          >
            <Tabs
              label="Library sections"
              tabs={[
                { id: "nightstand", label: "Nightstand" },
                { id: "stack", label: "The stack" },
                { id: "drawer", label: "The drawer" },
              ]}
              value={tab}
              onChange={setTab}
            >
              <Card>
                <p className="text-sm text-fg-muted">
                  {tab === "nightstand" &&
                    "In progress — what's on the nightstand right now."}
                  {tab === "stack" && "Queued — the shortlist for what's next."}
                  {tab === "drawer" && "Finished — everything in the drawer."}
                </p>
              </Card>
            </Tabs>
          </Section>

          <Section
            title="Rating gradient"
            note="The four-step rating — loved, liked, fine, no. One tap each, thumb-width steps, lamplight fading down the scale. Tap the current choice to clear it."
          >
            <RatingGradient
              label="Rate this title"
              value={rating}
              onChange={setRating}
            />
            <Caption>
              Current value: {rating ?? "none"} · arrow keys move the
              selection.
            </Caption>
          </Section>

          <Section
            title="Sheet"
            note="Bottom sheet on a native dialog — focus trapped, Escape and backdrop-tap close it, safe-area padded. Rises with the log-flow mock inside."
          >
            <div>
              <Button variant="quiet" onClick={() => setSheetOpen(true)}>
                Open sheet
              </Button>
            </div>
            <Sheet
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              title="Log The Overstory"
            >
              <div className="flex flex-col gap-5">
                <RatingGradient
                  label="Rate The Overstory"
                  value={sheetRating}
                  onChange={setSheetRating}
                />
                <div className="flex flex-wrap gap-2">
                  {tasteTags.slice(0, 3).map((tag) => (
                    <Chip
                      key={tag}
                      selected={sheetTags.includes(tag)}
                      onClick={() =>
                        setSheetTags((current) =>
                          current.includes(tag)
                            ? current.filter((t) => t !== tag)
                            : [...current, tag],
                        )
                      }
                    >
                      {tag}
                    </Chip>
                  ))}
                </div>
                <Button onClick={() => setSheetOpen(false)}>Done</Button>
              </div>
            </Sheet>
          </Section>

          <Section
            title="Tab bar"
            note="The bottom navigation below is the real thing: sticky in flow, so it can never sit on top of content — nothing gets cut off behind it — and it pads itself for the home indicator. Destinations land in later beads; Tonight is marked current here."
          >
            <Caption>
              Scroll to the end of this page: the last line of content stops
              above the bar instead of disappearing behind it.
            </Caption>
          </Section>
        </div>
      </main>

      <TabBar items={tabBarItems} />
    </div>
  );
}
