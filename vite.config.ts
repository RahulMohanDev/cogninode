/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react            from "@vitejs/plugin-react";
import tailwindcss      from "@tailwindcss/vite";
import { resolve }      from "path";

// Same-origin proxy for embedding-model downloads. Hugging Face serves
// model files via a cross-origin redirect (huggingface.co → cas-bridge
// .xethub.hf.co); the redirect taints the request origin to "null" and the
// browser rejects the response with a CORS AllowOriginMismatch on
// localhost. Routing through the dev server (which follows the redirect
// in Node, where CORS doesn't exist) sidesteps the whole class of problem.
// The worker points env.remoteHost at /hf when running on localhost.
const HF_PROXY = {
  "/hf": {
    target:          "https://huggingface.co",
    changeOrigin:    true,
    followRedirects: true,
    rewrite:         (path: string) => path.replace(/^\/hf/, ""),
  },
} as const;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals:     true,
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  server:  { proxy: HF_PROXY },
  preview: { proxy: HF_PROXY },
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
