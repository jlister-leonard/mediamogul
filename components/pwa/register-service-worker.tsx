"use client";

import { useEffect } from "react";

/** Registers the app-shell service worker. Production only, so dev never
 *  fights a stale cache. Renders nothing. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failure just means no offline shell; the app still works.
    });
  }, []);
  return null;
}
