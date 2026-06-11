// src/lib/search/embedding/embedder.ts
// Main-thread handle on the embedding worker, behind a deliberately tiny
// interface so the post-beta server-side swap (OpenRouter's
// POST /api/v1/embeddings) is a drop-in second implementation.

import { getEmbeddingModel, type EmbeddingModelSpec } from "./models";

export interface Embedder {
  readonly spec: EmbeddingModelSpec;
  /** Resolve when the model is downloaded + loaded. Reports download %. */
  init(onProgress: (pct: number) => void): Promise<void>;
  /** Embed document texts (doc prefix applied). Normalized vectors. */
  embedDocs(texts: string[]): Promise<Float32Array[]>;
  /** Embed one query (query prefix applied). Normalized vector. */
  embedQuery(text: string): Promise<Float32Array>;
  dispose(): void;
}

type Pending = {
  resolve: (value: { dims: number; buffer: ArrayBuffer }) => void;
  reject:  (err: Error) => void;
};

/** Local, fully in-browser embedder backed by the transformers.js worker. */
export class LocalEmbedder implements Embedder {
  readonly spec: EmbeddingModelSpec;
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initPending: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private onProgress: ((pct: number) => void) | null = null;

  constructor(modelId: string) {
    this.spec = getEmbeddingModel(modelId);
  }

  init(onProgress: (pct: number) => void): Promise<void> {
    if (this.worker) return Promise.resolve();
    this.onProgress = onProgress;
    this.worker = new Worker(
      new URL("../../../workers/embedding.worker.ts", import.meta.url),
      { type: "module", name: "cogninode-embeddings" },
    );
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", (e) => {
      this.failAll(new Error(e.message || "embedding worker crashed"));
    });

    const id = this.nextId++;
    return new Promise<void>((resolve, reject) => {
      this.initPending = { resolve, reject };
      this.worker!.postMessage({ type: "init", id, hfId: this.spec.hfId, dtype: this.spec.dtype });
    });
  }

  private onMessage = (e: MessageEvent): void => {
    const msg = e.data as
      | { type: "progress"; pct: number }
      | { type: "ready"; id: number }
      | { type: "vectors"; id: number; dims: number; buffer: ArrayBuffer }
      | { type: "error"; id?: number; message: string };

    if (msg.type === "progress") {
      this.onProgress?.(msg.pct);
      return;
    }
    if (msg.type === "ready") {
      this.initPending?.resolve();
      this.initPending = null;
      return;
    }
    if (msg.type === "vectors") {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        p.resolve({ dims: msg.dims, buffer: msg.buffer });
      }
      return;
    }
    const err = new Error(msg.message);
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        p.reject(err);
        return;
      }
    }
    this.initPending?.reject(err);
    this.initPending = null;
  };

  private failAll(err: Error): void {
    this.initPending?.reject(err);
    this.initPending = null;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private request(texts: string[]): Promise<{ dims: number; buffer: ArrayBuffer }> {
    if (!this.worker) return Promise.reject(new Error("embedder not initialized"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: "embed", id, texts });
    });
  }

  async embedDocs(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const prefixed = texts.map(t => this.spec.docPrefix + t);
    const { dims, buffer } = await this.request(prefixed);
    const flat = new Float32Array(buffer);
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      out.push(flat.slice(i * dims, (i + 1) * dims));
    }
    return out;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const { dims, buffer } = await this.request([this.spec.queryPrefix + text]);
    return new Float32Array(buffer, 0, dims).slice();
  }

  dispose(): void {
    this.failAll(new Error("embedder disposed"));
    this.worker?.terminate();
    this.worker = null;
  }
}