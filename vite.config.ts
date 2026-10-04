import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Unique per build so running tablets can detect a new deploy and reload.
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;
const buildId =
  nodeEnv?.GITHUB_SHA?.slice(0, 12) ?? new Date().toISOString();

function buildVersionFile(): Plugin {
  return {
    name: "arena-build-version",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ buildId }),
      });
    },
  };
}

export default defineConfig({
  define: { __ARENA_BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    buildVersionFile(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,ico,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
      },
      manifest: {
        name: "Arena Command — Destiny Ranch Arena",
        short_name: "Arena Command",
        description:
          "Destiny Ranch Arena events, online entries, and official team roping results.",
        theme_color: "#1c211d",
        background_color: "#1c211d",
        display: "standalone",
        icons: [
          {
            src: "destiny-ranch-arena-logo.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
  base: "./",
});
