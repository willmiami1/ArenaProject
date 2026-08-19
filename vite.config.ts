import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
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
