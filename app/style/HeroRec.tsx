"use client";

import { useState } from "react";
import { Button, Card, Chip } from "@/components/ui";
import { Cover } from "./Cover";
import { GetItRow } from "./GetItRow";

/**
 * The hero recommendation — one pick, dealt (PLAN §4.4).
 *
 * A hand, not a haystack: the engine has already chosen, so the card can
 * afford to spend the whole screen width on the artwork and one honest
 * sentence about why. Three things Goodreads never does, all here:
 *
 *   · the art is the largest element, not a 1/6-row thumbnail;
 *   · the reason cites the reader's own ratings rather than a crowd average;
 *   · the card is dismissible with a reason, because rejection is the signal
 *     nobody collects (PLAN §4.3).
 *
 * The card also carries `ns-accent--prometheus`: its `--accent` is the color
 * pulled off this cover, so the primary button, the "Why this" label, the
 * focus rings and the wash behind the art are all tinted by the book you're
 * being handed. Every other card on a real Tonight screen would be tinted by
 * its own.
 */

/** One tap each — the rejection vocabulary from `lib/types/rec.ts`, in the product's words. */
const notTonightReasons = [
  "Too long",
  "Not the mood",
  "Wrong vibe",
  "Read it already",
  "Bounced off it",
  "Can't get it",
] as const;

export function HeroRec() {
  const [askingWhy, setAskingWhy] = useState(false);

  return (
    <Card
      as="article"
      padded={false}
      className="ns-rec-card ns-accent--prometheus"
    >
      <div className="ns-rec-art grid place-items-center px-6 pt-8 pb-8">
        <Cover id="prometheus" className="w-[56%]" />
      </div>

      <div className="flex flex-col gap-5 px-5 pb-5">
        <header className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold tracking-[0.14em] text-fg-muted uppercase">
            Book · 721 pages · Lives
          </p>
          <h2 className="font-display text-2xl font-semibold">
            American Prometheus
          </h2>
          <p className="text-sm">Kai Bird &amp; Martin J. Sherwin</p>
          {/* Demoted, not amputated. The teardown's complaint about Goodreads
              is a subtitle that wraps five lines AND still truncates; a
              subtitle that clips its own subject mid-word ("…Oppenhe…") is
              the same sin in miniature, so this one is set small enough to
              land whole on one line. */}
          <p className="truncate text-xs text-fg-muted">
            The Triumph and Tragedy of J. Robert Oppenheimer
          </p>
        </header>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Why this
          </h3>
          {/* Every claim in this sentence survives the source corpus: the
              Goodreads export records Steve Jobs at 5★, Titan at 4★, and
              American Prometheus at position 3 on the to-read shelf. The
              Social Network is a five-star hearted film in the Letterboxd
              set (TASTE-BASELINE Finding 7), supplying the cross-media wedge. */}
          <p className="text-base">
            You gave <cite className="font-display italic">Steve Jobs</cite>{" "}
            5 stars and <cite className="font-display italic">Titan</cite> 4
            stars. <cite className="font-display italic">American Prometheus</cite>{" "}
            is on your 17-book to-read shelf. You gave{" "}
            <cite className="font-display italic">The Social Network</cite> five
            stars — same shape: one man, an institution, and the moment it gets
            away from him.
          </p>
          <p className="mt-2 flex items-center gap-3 text-xs text-fg-muted">
            <span aria-hidden className="font-display text-lg font-semibold text-accent">
              #3
            </span>
            <span>of 17 on your to-read shelf.</span>
          </p>
        </div>

        <GetItRow
          book={{
            title: "American Prometheus",
            author: "Kai Bird",
            isbn13: "9780375726262",
          }}
        />

        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Button className="flex-1">Start it tonight</Button>
            <Button
              variant="ghost"
              aria-expanded={askingWhy}
              aria-controls="not-tonight-reasons"
              onClick={() => setAskingWhy((open) => !open)}
            >
              Not tonight
            </Button>
          </div>

          {askingWhy ? (
            <div id="not-tonight-reasons" className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold tracking-[0.14em] text-fg-muted uppercase">
                What put you off?
              </h3>
              <div className="flex flex-wrap gap-2">
                {notTonightReasons.map((reason) => (
                  // A chip's default surface is one step above the *ground*;
                  // inside a card that is already raised it reads as a dent.
                  // Chips nested in a card take the next step up instead.
                  <Chip key={reason} className="bg-overlay!">
                    {reason}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
