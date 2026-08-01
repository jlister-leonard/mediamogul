import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { THEATER_ZIP_STORAGE_KEY } from "@/lib/availability/theaters";
import TheaterSettingsPage, { locationResultNotice } from "./page";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

it("discloses BigDataCloud and does not request or fetch before an explicit click", async () => {
  const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>(
    (success) => {
      success({ coords: { latitude: 40.7128, longitude: -74.006 } } as GeolocationPosition);
    },
  );
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  let finishLookup: ((response: Response) => void) | undefined;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => {
    finishLookup = resolve;
  }));
  vi.stubGlobal("fetch", fetch);

  render(<TheaterSettingsPage />);
  expect(screen.getByText(/requesting IP address go directly.*BigDataCloud/i)).toBeTruthy();
  expect(screen.getByRole("link", { name: "location-data explanation" }).getAttribute("href"))
    .toContain("bigdatacloud.com/docs/");
  expect(screen.getByRole("link", { name: "privacy policy" }).getAttribute("href"))
    .toBe("https://www.bigdatacloud.com/privacy-and-cookie-policy");
  expect(getCurrentPosition).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Find ZIP using my location" }));
  const loadingButton = screen.getByRole("button", { name: "Finding ZIP…" });
  expect(loadingButton.hasAttribute("disabled")).toBe(true);
  finishLookup?.(new Response(JSON.stringify({
    lookupSource: "coordinates",
    countryCode: "US",
    postcode: "10007",
  })));
  expect(await screen.findByDisplayValue("10007")).toBeTruthy();
  expect(getCurrentPosition).toHaveBeenCalledOnce();
  expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
    enableHighAccuracy: false,
    maximumAge: 0,
    timeout: 10_000,
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(localStorage.getItem(THEATER_ZIP_STORAGE_KEY)).toBeNull();
  expect((await screen.findByRole("status")).textContent).toContain("Review it");

  fireEvent.click(screen.getByRole("button", { name: "Save ZIP" }));
  expect(localStorage.getItem(THEATER_ZIP_STORAGE_KEY)).toBe("10007");
});

it("reports every future geolocation outcome without silently saving", () => {
  expect(locationResultNotice({ ok: true, zip: "10001" })).toContain("Review it");
  expect(locationResultNotice({ ok: false, reason: "unsupported" })).toContain("does not support");
  expect(locationResultNotice({ ok: false, reason: "permission-denied" })).toContain("denied");
  expect(locationResultNotice({ ok: false, reason: "timeout" })).toContain("timed out");
  expect(locationResultNotice({ ok: false, reason: "service-blocked" })).toContain("refused");
  expect(locationResultNotice({ ok: false, reason: "unavailable" })).toContain("failed");
  expect(locationResultNotice({ ok: false, reason: "non-us" })).toContain("outside the United States");
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
