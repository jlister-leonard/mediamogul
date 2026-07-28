import { defineConfig, devices } from "@playwright/test";

// Let context.route() see requests made by service workers, so the offline
// e2e test can sever the worker from the network. context.setOffline() alone
// only affects the page, not the worker's own fetch().
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:3000",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build: the service worker only registers in production,
    // and the offline-shell e2e test must exercise the real thing.
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // SIGTERM the whole process group so next-server exits with the shell;
    // the default SIGKILL orphans it, and a stale reused server then serves
    // an outdated build to later runs.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
