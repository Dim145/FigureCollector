import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Single source of truth for the version shown in the UI (footer + landing
// kicker): the package.json version, injected at build time. Read from the
// file rather than process.env.npm_package_version so it works regardless of
// how Vite is invoked (pnpm script, bare `vite build`, IDE runner).
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "script",
      includeAssets: ["favicon.svg", "robots.txt"],
      manifest: {
        name: "FigureCollector",
        short_name: "FigureCol",
        description:
          "Self-hosted PWA for tracking your figurine collection. Offline-first, hardened containers.",
        theme_color: "#0a0807",
        background_color: "#0a0807",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        lang: "fr",
        categories: ["productivity", "lifestyle", "utilities"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // ---- Precache (hashed build outputs)
        // wasm + onnx artefacts can weigh tens of MB (ONNX Runtime for the
        // the BiRefNet bg-removal model is ~88 MB on its own). We exclude them from
        // the precache manifest and cache them at runtime when they're first
        // requested, so users who never invoke "Détourer" never pay for them.
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"],
        globIgnores: ["**/ort-wasm-*", "**/*.wasm", "**/*.onnx"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/_/, /^\/photos\//],
        clientsClaim: true,
        skipWaiting: false,
        // Inject the push event handler into the generated SW so a
        // single service worker registration handles both precaching
        // and Web Push delivery.
        importScripts: ["/push-handler.js"],
        // ---- Runtime caching strategies
        runtimeCaching: [
          // Backend-served photos (immutable; storage_key changes per upload).
          {
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith("/api/photos/") && request.method === "GET",
            // NetworkFirst (not CacheFirst): these are PRIVATE per-user photos,
            // served `Cache-Control: private, max-age=0, must-revalidate`. Online
            // we always revalidate first, so once the session ends the network
            // 401s and no stale private bytes are served — the cache is only an
            // offline fallback while authenticated. statuses:[200] only (never
            // store an opaque/error response). Paired with api.js purging these
            // caches on any 401 (covers the offline copy + shared-device case).
            handler: "NetworkFirst",
            options: {
              cacheName: "fc-photos",
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          // Catalog COVER photos (/api/figure-photos/) — the catalogue grid
          // fans out dozens of these at once; previously NO rule matched them
          // (the rule above is /api/photos/, without the `figure-`), so every
          // cover hit the network every load and a transient failure (store-CDN
          // rate-limit / pool pressure) left the <img> silently broken until a
          // manual reload. StaleWhileRevalidate serves the cached copy INSTANTLY
          // (already-loaded covers always reappear, no network dependency) and
          // refreshes in the background, so edit-in-place changes still surface
          // on the next view. statuses:[200] only — never cache an error/opaque
          // response (that would re-introduce a stuck-broken cover).
          {
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith("/api/figure-photos/") && request.method === "GET",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "fc-figure-covers",
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          // Catalog reads — NetworkFirst so a freshly-mutated catalog
          // (new figure, new primary photo, deleted figure, NSFW flag
          // flip on /me) shows up on the very next navigation. The
          // earlier StaleWhileRevalidate served the cached snapshot
          // synchronously and only revalidated in the background, so
          // TanStack always received the stale list on its first
          // refetch — visible symptoms were "new figurines don't appear
          // in the catalogue" and "thumbnail change requires a page
          // reload". NetworkFirst keeps the cache as an offline fallback
          // (when network truly fails) without ever masking fresh data
          // online. `networkTimeoutSeconds: 3` handles a brief blip on a
          // slow link gracefully.
          {
            urlPattern: ({ url, request }) =>
              (url.pathname === "/api/figures" ||
                /^\/api\/figures\/[^/]+$/.test(url.pathname)) &&
              request.method === "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "fc-figures",
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24, // 24h
              },
              // [200] only — the /api caches must never store an opaque (status 0)
              // cross-origin/redirected response and serve it back as data.
              cacheableResponse: { statuses: [200] },
            },
          },
          // External metadata proxies (AniList / MFC) — long cache, SWR.
          {
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith("/api/external/") && request.method === "GET",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "fc-external",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24, // 24h (matches backend cache)
              },
              cacheableResponse: { statuses: [200] }, // [200] only — never store opaque
            },
          },
          // ONNX Runtime WASM + ML model weights — cache on first use, keep
          // forever (hashed asset URLs change on rebuild anyway).
          {
            urlPattern: ({ url }) => /\.(wasm|onnx)(\?.*)?$/i.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "fc-ml-assets",
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
          // Google Fonts CSS & font files (Direction B typography).
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-css",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-files",
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    cssMinify: "lightningcss",
    // Split the giant ML/imaging libs into their own vendor chunks so
    // routes that never reach for them (most of the app) don't pay the
    // cost. The chunk-size warning was firing at 682 kB / 1020 kB on a
    // single bundle — splitting brings the largest non-ML chunk under
    // the 500 kB default + makes the ML ones lazy-cacheable.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // transformers.js (visual-search embedding) — matched BEFORE the
            // bg-removal branch since both pull in onnxruntime-web.
            if (id.includes("@huggingface/transformers")) {
              return "vendor-transformers";
            }
            if (id.includes("onnxruntime-web")) {
              return "vendor-bgremoval";
            }
            if (id.includes("gsplat")) {
              return "vendor-gsplat";
            }
            if (id.includes("filerobot-image-editor")) {
              return "vendor-image-editor";
            }
            if (
              id.includes("react-dom") ||
              id.includes("react-router") ||
              (id.includes("/react/") && !id.includes("react-query"))
            ) {
              return "vendor-react";
            }
            if (id.includes("@tanstack/react-query")) {
              return "vendor-query";
            }
            if (id.includes("dexie")) {
              return "vendor-dexie";
            }
          }
          return undefined;
        },
      },
    },
    // The two ML/imaging vendor chunks legitimately exceed 500 kB — they
    // are lazy-loaded on the routes that need them, so the warning would
    // be misleading. Bump just enough to silence it while still catching
    // accidental bloat in the main bundle.
    chunkSizeWarningLimit: 1100,
  },
});
