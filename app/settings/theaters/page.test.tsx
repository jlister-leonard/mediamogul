import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { THEATER_ZIP_STORAGE_KEY } from "@/lib/availability/theaters";
import TheaterSettingsPage, { locationResultNotice } from "./page";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("validates, persists, reloads, and removes one device-local ZIP", async () => {
  const first = render(<TheaterSettingsPage />);
  const input = screen.getByRole("textbox", { name: "US ZIP code" });
  fireEvent.change(input, { target: { value: "not-a-zip" } });
  fireEvent.click(screen.getByRole("button", { name: "Save ZIP" }));
  expect((await screen.findByRole("status")).textContent).toContain("valid 5-digit US ZIP");
  expect(localStorage.getItem(THEATER_ZIP_STORAGE_KEY)).toBeNull();

  fireEvent.change(input, { target: { value: " 10001 " } });
  fireEvent.click(screen.getByRole("button", { name: "Save ZIP" }));
  expect((await screen.findByRole("status")).textContent).toContain("ZIP saved on this device");
  expect(localStorage.getItem(THEATER_ZIP_STORAGE_KEY)).toBe("10001");

  first.unmount();
  render(<TheaterSettingsPage />);
  expect(await screen.findByDisplayValue("10001")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove ZIP" }));
  expect(localStorage.getItem(THEATER_ZIP_STORAGE_KEY)).toBeNull();
});

it("honestly leaves geolocation disabled without prompting", async () => {
  render(<TheaterSettingsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Check location option" }));
  expect((await screen.findByRole("status")).textContent).toContain(
    "no location permission was requested",
  );
});

it("reports every future geolocation outcome without silently saving", () => {
  expect(locationResultNotice({ ok: true, zip: "10001" })).toContain("Review it");
  expect(locationResultNotice({ ok: false, reason: "unsupported" })).toContain("does not support");
  expect(locationResultNotice({ ok: false, reason: "permission-denied" })).toContain("denied");
  expect(locationResultNotice({ ok: false, reason: "unavailable" })).toContain("could not be read");
  expect(locationResultNotice({ ok: false, reason: "invalid-zip" })).toContain("valid US ZIP");
  expect(localStorage.getItem(THEATER_ZIP_STORAGE_KEY)).toBeNull();
});

it("does not claim removal or clear the field when browser storage rejects it", async () => {
  localStorage.setItem(THEATER_ZIP_STORAGE_KEY, "10001");
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  try {
    render(<TheaterSettingsPage />);
    const input = await screen.findByDisplayValue("10001");
    fireEvent.click(screen.getByRole("button", { name: "Remove ZIP" }));
    expect(input.getAttribute("value")).toBe("10001");
    expect((await screen.findByRole("status")).textContent).toContain(
      "would not let Nightstand remove",
    );
  } finally {
    remove.mockRestore();
  }
});
