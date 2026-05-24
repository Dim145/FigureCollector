import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
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
        // @imgly bg-removal model is ~24 MB on its own). We exclude them from
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
        // ---- Runtime caching strategies
        runtimeCaching: [
          // Backend-served photos (immutable; storage_key changes per upload).
          {
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith("/api/photos/") && request.method === "GET",
            handler: "CacheFirst",
            options: {
              cacheName: "fc-photos",
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Catalog reads — fresh-but-fast.
          {
            urlPattern: ({ url, request }) =>
              (url.pathname === "/api/figures" ||
                /^\/api\/figures\/[^/]+$/.test(url.pathname)) &&
              request.method === "GET",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "fc-figures",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24, // 24h
              },
              cacheableResponse: { statuses: [0, 200] },
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
              cacheableResponse: { statuses: [0, 200] },
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
  },
});
