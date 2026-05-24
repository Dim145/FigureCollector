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
      registerType: "autoUpdate",
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
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2,wasm}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/_/],
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
