"use client";

import { useEffect, useState } from "react";
import { TheatersNowChip } from "@/components/recommendations/TheatersNowChip";
import { fetchTmdbNowPlaying } from "@/lib/availability/client";
import {
  moviesInTheatersNowChip,
  type MoviesInTheatersNowChipData,
} from "@/lib/availability/theaters";

const unavailable = moviesInTheatersNowChip([]);

/** The real Recommendations landing surface; later E6 beads add the dealt hand. */
export default function RecommendationsPage() {
  const [theaters, setTheaters] = useState<MoviesInTheatersNowChipData>(unavailable);
  const [selection, setSelection] = useState<MoviesInTheatersNowChipData>();

  useEffect(() => {
    let active = true;
    void fetchTmdbNowPlaying().then((result) => {
      if (active && result.ok) setTheaters(moviesInTheatersNowChip(result.data));
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-6 py-12">
      <p className="text-sm font-medium text-accent">Nightstand</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Recommendations</h1>
      <p className="mt-3 text-fg-muted">Choose an opening for what fits tonight.</p>

      <section aria-labelledby="situations-heading" className="mt-8">
        <h2 id="situations-heading" className="sr-only">Situations</h2>
        <TheatersNowChip data={theaters} onSelect={setSelection} />
      </section>

      {selection ? (
        <p role="status" aria-live="polite" className="mt-6 text-sm text-fg-muted">
          {selection.entries.length} confirmed theater {selection.entries.length === 1 ? "movie" : "movies"} ready for this recommendation.
        </p>
      ) : null}
    </main>
  );
}
