import { defineConfig, devices } from "@playwright/test";

// E2E runs against the ephemeral stack from docker-compose.e2e.yml (client on
// :5273). Override E2E_BASE_URL to point at any other running instance.
const baseURL = process.env.E2E_BASE_URL || "http://localhost:5273";

export default defineConfig({
  testDir: "./e2e",
  // Registers the disposable test user once and writes its session to disk;
  // every spec then reuses that authenticated state (see `use.storageState`).
  globalSetup: "./e2e/global-setup.js",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // One shared backend + DB → keep runs serial and deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    storageState: "e2e/.auth/user.json",
    // Force the UI language so label-based selectors are deterministic: the
    // i18n provider falls back to navigator.language (no stored preference on a
    // fresh account), and Playwright drives navigator.language from `locale`.
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
