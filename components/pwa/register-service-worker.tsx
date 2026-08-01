"use client";

import { useEffect } from "react";

/** Registers the app-shell service worker. Production only, so dev never
 *  fights a stale cache. Renders nothing. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // updateViaCache="none" prevents the browser's HTTP cache from hiding a
    // newly deployed worker, while all version migration remains atomic in
    // the worker's install/activate lifecycle.
    const reportNetworkStatus = () => {
      navigator.serviceWorker.controller?.postMessage({
        type: "NETWORK_STATUS",
        online: navigator.onLine,
      });
    };

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then(reportNetworkStatus)
      .catch(() => {
        // Registration failure just means no offline shell; the app still works.
      });
    window.addEventListener("online", reportNetworkStatus);
    window.addEventListener("offline", reportNetworkStatus);
    navigator.serviceWorker.addEventListener("controllerchange", reportNetworkStatus);
    return () => {
      window.removeEventListener("online", reportNetworkStatus);
      window.removeEventListener("offline", reportNetworkStatus);
      navigator.serviceWorker.removeEventListener("controllerchange", reportNetworkStatus);
    };
  }, []);
  return null;
}
