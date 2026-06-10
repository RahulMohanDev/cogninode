/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react            from "@vitejs/plugin-react";
import tailwindcss      from "@tailwindcss/vite";
import { resolve }      from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals:     true,
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  // pdf.js worker file — served as a static asset
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["pdfjs-dist"],   // dynamic import — don't pre-bundle
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:     ["react", "react-dom", "react-router-dom"],
          dexie:      ["dexie", "dexie-react-hooks"],
          // Streamdown pulls shiki + katex + mermaid + remark/rehype etc.
          // Split into its own chunk so it loads in parallel with the main
          // bundle and stays cached across our app updates.
          streamdown: ["streamdown"],
        },
      },
    },
  },
});
