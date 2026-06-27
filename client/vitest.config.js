// Vitest config — deliberately separate from vite.config.js so the test run
// does NOT load the PWA / Tailwind / React plugins (the units here are pure
// functions; we want a fast, plugin-free node run). Vitest gives this file
// priority over vite.config.js, so none of the build pipeline is pulled in.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Keep the same `@/` → `src/` alias the app uses, so a test can import a
    // module that itself imports via the alias.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,jsx}"],
    globals: false,
    // Pin the timezone so any date-derived assertion is reproducible across
    // machines and CI runners.
    env: { TZ: "UTC" },
  },
});
