// src/workers/embedding.worker.ts
// Dedicated worker that owns the transformers.js feature-extraction
// pipeline so model download + inference never block the UI thread.
// WebGPU when available, WASM otherwise; weights cached by the browser
// Cache API ("transformers-cache") for offline reuse.
//
// Protocol (all messages carry the request `id` they answer):
//   in : { type: "init",  id, hfId, dtype }
//   out: { type: "progress", pct }            // download progress 0-100
//   out: { type: "ready", id }                // init done
//   in : { type: "embed", id, texts }
//   out: { type: "vectors", id, dims, buffer } // one Float32Array, row-major
//   out: { type: "error", id?, message }

import { pipeline, env } from "@huggingface/transformers";

// Self-host the onnxruntime WASM runtime. transformers.js defaults
// `wasmPaths` to cdn.jsdelivr.net, which adds a second remote dependency
// (beyond the model weights on huggingface.co) that ad-blockers and flaky
// networks love to kill with a bare "Failed to fetch". Vite bundles the
// exact files from our own node_modules instead, so the ONLY remote fetch
// left is the model itself. Pair selection mirrors transformers' own
// logic: Safari gets the plain build, everything else asyncify.
import ortAsyncifyMjs  from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortAsyncifyWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortPlainMjs     from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortPlainWasm    from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

// Typed alias for the worker global without pulling in the webworker lib
// (which conflicts with "dom" in one tsconfig program).
const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", cb: (e: MessageEvent) => void): void;
};

env.allowLocalModels = false;

// On localhost, download model files through the Vite dev-server proxy
// (vite.config.ts → /hf) instead of huggingface.co directly: HF's
// cross-origin redirect to its cas-bridge storage host fails the
// browser's CORS check from a localhost origin (AllowOriginMismatch).
// Same-origin requests have no CORS to fail; the dev server follows the
// redirect in Node. Deployed origins keep the direct default.
const isLocalhost =
  self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";
if (isLocalhost) {
  env.remoteHost = `${self.location.origin}/hf`;
}

const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const onnxEnv = (env.backends as { onnx?: { wasm?: { wasmPaths?: unknown } } }).onnx;
if (onnxEnv?.wasm) {
  onnxEnv.wasm.wasmPaths = isSafari
    ? { mjs: new URL(ortPlainMjs,     self.location.href).href,
        wasm: new URL(ortPlainWasm,    self.location.href).href }
    : { mjs: new URL(ortAsyncifyMjs,  self.location.href).href,
        wasm: new URL(ortAsyncifyWasm, self.location.href).href };
}

type InMessage =
  | { type: "init"; id: number; hfId: string; dtype: string }
  | { type: "embed"; id: number; texts: string[] };

type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractor: Extractor | null = null;

// Per-file download progress → one overall percentage. transformers.js
// emits independent progress streams per file; we aggregate by bytes.
// `lastFile` rides along so init failures can say WHICH fetch died
// instead of a bare "Failed to fetch".
const fileProgress = new Map<string, { loaded: number; total: number }>();
let lastPct = -1;
let lastFile: string | null = null;

function onProgress(p: { status?: string; file?: string; loaded?: number; total?: number }): void {
  if (p.file) lastFile = p.file;
  if (p.status !== "progress" || !p.file || !p.total) return;
  fileProgress.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
  let loaded = 0, total = 0;
  for (const f of fileProgress.values()) { loaded += f.loaded; total += f.total; }
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  if (pct !== lastPct) {
    lastPct = pct;
    ctx.postMessage({ type: "progress", pct });
  }
}

async function init(id: number, hfId: string, dtype: string): Promise<void> {
  const device = "gpu" in navigator ? "webgpu" : "wasm";
  try {
    extractor = await pipeline("feature-extraction", hfId, {
      dtype:             dtype as never,
      device:            device as never,
      progress_callback: onProgress,
    }) as unknown as Extractor;
  } catch (err) {
    if (device === "webgpu") {
      // WebGPU init can fail on driver/adapter quirks — retry on WASM.
      extractor = await pipeline("feature-extraction", hfId, {
        dtype:             dtype as never,
        device:            "wasm" as never,
        progress_callback: onProgress,
      }) as unknown as Extractor;
    } else {
      throw err;
    }
  }
  ctx.postMessage({ type: "ready", id });
}

async function embed(id: number, texts: string[]): Promise<void> {
  if (!extractor) throw new Error("embedding pipeline not initialized");
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const dims = output.dims[output.dims.length - 1] ?? 0;
  // Copy out of the tensor before transferring ownership to the main thread.
  const buffer = output.data.slice().buffer;
  ctx.postMessage({ type: "vectors", id, dims, buffer }, [buffer]);
}

ctx.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as InMessage;
  void (async () => {
    try {
      if (msg.type === "init")  await init(msg.id, msg.hfId, msg.dtype);
      if (msg.type === "embed") await embed(msg.id, msg.texts);
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err);
      if (msg.type === "init") {
        // "Failed to fetch" alone is undebuggable — name the file and the
        // likely culprits.
        const where = lastFile ? ` while fetching "${lastFile}"` : "";
        message = `model download failed${where}: ${message}. ` +
          "Check your connection (and any ad-blocker on huggingface.co), then retry from Settings → Search.";
      }
      ctx.postMessage({ type: "error", id: msg.id, message });
    }
  })();
});