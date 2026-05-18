import { defineConfig } from "vite";
import react            from "@vitejs/plugin-react";
import { resolve }      from "path";

export default defineConfig({
  plugins: [react()],
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
          vendor: ["react", "react-dom", "react-router-dom"],
          dexie:  ["dexie", "dexie-react-hooks"],
        },
      },
    },
  },
});
