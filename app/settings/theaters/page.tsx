"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  clearTheaterZip,
  readTheaterZip,
  requestTheaterZipFromLocation,
  saveTheaterZip,
  type LocationZipResult,
} from "@/lib/availability/theaters";

export function locationResultNotice(result: LocationZipResult): string {
  if (result.ok) return `ZIP ${result.zip} found. Review it, then choose Save ZIP.`;
  switch (result.reason) {
    case "not-enabled":
      return "Location lookup is not enabled. It requires choosing a trusted location processor first; no location permission was requested.";
    case "unsupported":
      return "This browser does not support location lookup. Enter your ZIP instead.";
    case "permission-denied":
      return "Location permission was denied. Nothing was stored; enter your ZIP instead.";
    case "unavailable":
      return "Your location could not be read. Nothing was stored; enter your ZIP instead.";
    case "invalid-zip":
      return "The location result did not contain a valid US ZIP. Nothing was stored; enter it manually.";
  }
}

export default function TheaterSettingsPage() {
  const [zip, setZip] = useState("");
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    // Keep the server and first browser render identical, then hydrate the
    // device-local value without a synchronous effect render cascade.
    let active = true;
    queueMicrotask(() => {
      if (active) setZip(readTheaterZip() ?? "");
    });
    return () => {
      active = false;
    };
  }, []);

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = saveTheaterZip(zip);
    if (result.ok) {
      setZip(result.zip);
      setNotice("ZIP saved on this device.");
    } else {
      setNotice(
        result.reason === "invalid"
          ? "Enter a valid 5-digit US ZIP (an optional 4-digit suffix is okay)."
          : "This browser would not let Nightstand save the ZIP.",
      );
    }
  }

  async function handleLocation() {
    const result = await requestTheaterZipFromLocation();
    if (result.ok) setZip(result.zip);
    setNotice(locationResultNotice(result));
  }

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-6 py-12">
      <p className="text-sm font-medium text-accent">Settings</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Movie theaters</h1>
      <p className="mt-3 text-fg-muted">
        Save one US ZIP on this device for nearby showtimes. Nightstand does not
        send it to Fandango until Fandango&apos;s location-link behavior is verified.
      </p>

      <form onSubmit={handleSave} className="mt-10 rounded-xl bg-surface p-6">
        <Input
          label="US ZIP code"
          hint="Stored only in this browser. Example: 10001."
          inputMode="numeric"
          autoComplete="postal-code"
          value={zip}
          onChange={(event) => setZip(event.currentTarget.value)}
        />
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit">Save ZIP</Button>
          <Button
            variant="quiet"
            onClick={() => {
              if (clearTheaterZip()) {
                setZip("");
                setNotice("Saved ZIP removed from this device.");
              } else {
                setNotice("This browser would not let Nightstand remove the saved ZIP.");
              }
            }}
          >
            Remove ZIP
          </Button>
        </div>
      </form>

      <section aria-labelledby="location-heading" className="mt-6 rounded-xl bg-surface p-6">
        <h2 id="location-heading" className="text-xl font-semibold">Use my location</h2>
        <p className="mt-2 text-sm text-fg-muted">
          This privacy-sensitive option is paused until you approve a provider
          that can turn coordinates into a ZIP. Coordinates will never be stored.
        </p>
        <Button className="mt-5" variant="quiet" onClick={() => void handleLocation()}>
          Check location option
        </Button>
      </section>

      {notice ? <p role="status" aria-live="polite" className="mt-6 rounded-md bg-surface p-4 text-sm">{notice}</p> : null}
    </main>
  );
}
