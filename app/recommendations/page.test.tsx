import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import RecommendationsPage from "./page";

const mocks = vi.hoisted(() => ({ fetchTmdbNowPlaying: vi.fn() }));
vi.mock("@/lib/availability/client", () => mocks);

afterEach(() => {
  cleanup();
  mocks.fetchTmdbNowPlaying.mockReset();
});

it("mounts the now-playing chip on Recommendations and feeds its selection", async () => {
  mocks.fetchTmdbNowPlaying.mockResolvedValue({
    ok: true,
    data: [{
      seed: { medium: "movie", title: "Heat", creators: [], ref: { medium: "movie", tmdbId: 949 } },
      availability: { kind: "theater", region: "US", fetchedAt: new Date().toISOString() },
    }],
  });
  render(<RecommendationsPage />);

  expect(screen.getByRole("heading", { level: 1, name: "Recommendations" })).toBeTruthy();
  const chip = await screen.findByRole("button", {
    name: "movies in theaters now, 1 confirmed",
  });
  expect(chip.hasAttribute("disabled")).toBe(false);
  fireEvent.click(chip);
  expect((await screen.findByRole("status")).textContent).toContain(
    "1 confirmed theater movie",
  );
});

it("keeps the theater chip disabled when the capped feed is unavailable", async () => {
  mocks.fetchTmdbNowPlaying.mockResolvedValue({
    ok: false,
    error: { code: "provider-unreachable", message: "offline" },
  });
  render(<RecommendationsPage />);
  const chip = screen.getByRole("button", {
    name: "movies in theaters now, theater list unavailable",
  });
  expect(chip.hasAttribute("disabled")).toBe(true);
});
