import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TheatersNowChip } from "./TheatersNowChip";

it("exposes confirmed theater entries to the recommendation action", () => {
  const onSelect = vi.fn();
  const data = {
    id: "movies-in-theaters-now" as const,
    label: "movies in theaters now" as const,
    prompt: "Recommend a movie confirmed as playing in theaters now.",
    status: "present" as const,
    entries: [{
      seed: { medium: "movie" as const, title: "Dune", creators: [], ref: { medium: "movie" as const, tmdbId: 1 } },
      availability: { kind: "theater" as const, region: "US" as const, fetchedAt: "2026-08-01T12:00:00.000Z" },
    }],
    fetchedAt: "2026-08-01T12:00:00.000Z",
    stale: false,
  };
  render(<TheatersNowChip data={data} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: "movies in theaters now, 1 confirmed" }));
  expect(onSelect).toHaveBeenCalledWith(data);
});

it("disables the chip when the capped feed establishes no presence", () => {
  render(<TheatersNowChip data={{
    id: "movies-in-theaters-now",
    label: "movies in theaters now",
    prompt: "Recommend a movie confirmed as playing in theaters now.",
    status: "unknown",
    entries: [],
    stale: true,
  }} onSelect={vi.fn()} />);
  expect(
    screen
      .getByRole("button", { name: "movies in theaters now, theater list unavailable" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("Theater list may be out of date.")).toBeTruthy();
});
