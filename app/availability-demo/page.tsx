"use client";

import { useEffect, useState } from "react";
import { resolveItemAvailability } from "../../lib/availability";
import { itemSchema } from "../../lib/types";

const samples = [
  itemSchema.parse({
    id: "availability-demo-movie",
    medium: "movie",
    title: "Heat",
    creators: ["Michael Mann"],
    ref: { medium: "movie", tmdbId: 949 },
  }),
  itemSchema.parse({
    id: "availability-demo-podcast",
    medium: "podcast",
    title: "Acquired",
    creators: ["Ben Gilbert"],
    ref: { medium: "podcast", spotifyShowId: "show-123" },
  }),
  itemSchema.parse({
    id: "availability-demo-book",
    medium: "book",
    title: "Bad Blood",
    creators: ["John Carreyrou"],
    ref: { medium: "book", isbn13: "9781524731656" },
  }),
];

/** Internal production-bundle harness used by the browser verification suite. */
export default function AvailabilityDemoPage() {
  const [rows, setRows] = useState<string[]>([]);
  useEffect(() => {
    void Promise.all(samples.map((item) => resolveItemAvailability(item))).then((results) => {
      setRows(results.map((result, index) => {
        const offer = result.offers[0];
        const provider = offer && "providerId" in offer ? offer.providerId : "none";
        return `${samples[index].medium}:${provider}:${result.metadata.cache}`;
      }));
    });
  }, []);
  return (
    <main>
      <h1>Availability verification</h1>
      <output aria-live="polite">{rows.join("|")}</output>
    </main>
  );
}
