// src/lib/search/service.ts
// The search orchestrator. One module-level singleton owns:
//
//   · the BM25 keyword index — built from Dexie at boot (fast), kept
//     current within the session via Dexie table hooks, so search works
//     from the first keystroke with zero downloads;
//   · the OPTIONAL semantic layer — an embedding model that downloads in
//     the background, backfills vectors for the whole corpus with visible
//     progress, then upgrades retrieval to RRF(keyword, cosine);
//   · the publish/subscribe state the UI renders ("downloading 45%",
//     "indexing 120/890", "ready").
//
// StrictMode mounts effects twice in dev — every entry point here is
// idempotent.

import { db, sweepOrphanFiles, type StoredFile } from "../db";
import {
  collectAllDocs, loadDoc, parseDocId, textHash, docId as makeDocId,
  fileChunkDocs, parseFileChunkRawId, invalidateFileDocCache,
  type SearchDoc, type SearchDocKind,
} from "./docs";
import { chunksForFile } from "../docrag/chunk";
import { KeywordIndex, type KeywordHit } from "./keywordIndex";
import { rrfFuse }                 from "./fusion";
import { makeSnippet, type Snippet } from "./snippets";
import { VectorStore, type VectorHit } from "./vectorStore";
import { LocalEmbedder, type Embedder } from "./embedding/embedder";
import { getEmbeddingModel }       from "./embedding/models";

const EMBED_MAX_CHARS  = 1500;  // ~ the 512-token window of small embedders
const EMBED_BATCH      = 12;
const EMBED_BATCH_REST = 60;    // ms between batches — keep the tab smooth
const FLUSH_DELAY      = 120;   // ms debounce for write-hook updates
const BOOT_IDLE_DELAY  = 2500;  // ms after boot before the model download starts

export type SemanticPhase =
  | "off" | "starting" | "downloading" | "indexing" | "ready" | "error";

export interface SearchState {
  keywordReady: boolean;
  docCount:     number;
  semantic:     SemanticPhase;
  modelId:      string;
  downloadPct:  number;
  indexed:      number;
  indexTotal:   number;
  vectorCount:  number;
  error:        string | null;
}

export type HitSource = "keyword" | "semantic";

export interface ResolvedHit {
  docId:     string;
  kind:      SearchDocKind;
  rawId:     string;
  chatId:    string;
  nodeId:    string;
  chatTitle: string;
  /** Reflection title / branch label / chat title. Empty for messages. */
  title:     string;
  snippet:   Snippet | null;
  role?:     "user" | "assistant";
  /** fileChunk hits only: the earliest message that attached the file —
   *  navigation lands on (and can flash) that message. */
  messageId?: string;
  sources:   HitSource[];
  score:     number;
}

export interface SearchResponse {
  query:  string;
  hits:   ResolvedHit[];
  tookMs: number;
}

export function tokenizeQuery(q: string): string[] {
  return q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 1);
}

/** Text a doc gets embedded as (title + body window). */
function embedText(doc: SearchDoc): string {
  const joined = doc.title ? `${doc.title}\n${doc.text}` : doc.text;
  return joined.slice(0, EMBED_MAX_CHARS);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Doc kinds that get vectors (everything else is keyword-only). */
const EMBEDDED_KINDS = new Set<SearchDocKind>(["message", "reflection", "graphNode", "fileChunk"]);
type EmbeddedKind = "message" | "reflection" | "graphNode" | "fileChunk";

/** Global-search results keep at most this many chunk hits per file, so
 *  one big document can't flood the palette. */
const FILE_HITS_PER_FILE = 3;

/** Earliest non-dock message that attached a file — drives navigation. */
interface FileRef { chatId: string; nodeId: string; messageId: string; createdAt: number }

class SearchService {
  private keyword = new KeywordIndex();
  private keywordInit: Promise<void> | null = null;

  private embedder: Embedder | null = null;
  private vectors:  VectorStore | null = null;
  /** Token invalidating in-flight semantic work after a stop/switch. */
  private semanticRun = 0;
  private bootDelayUsed = false;
  /** Last configure() opts — replayed by retrySemantic(). */
  private lastOpts: { semanticSearch: boolean; embeddingModelId: string } | null = null;
  private autoRetryDone = false;

  private pendingUpserts = new Set<string>();  // doc ids
  private pendingRemoves = new Set<string>();
  /** Touched FILE ids (not doc ids) — one file expands to N chunk docs,
   *  which the flush resolves outside the write transaction. */
  private pendingFiles = new Set<string>();
  /** fileId → earliest non-dock message that attached it. Cached because
   *  computing it is a full messages scan; nulled on every message write. */
  private fileRefCache: Map<string, FileRef> | null = null;
  private flushTimer: number | null = null;
  private embedQueue = new Set<string>();      // doc ids awaiting (re)embed
  private pumping = false;

  private state: SearchState = {
    keywordReady: false,
    docCount:     0,
    semantic:     "off",
    modelId:      "",
    downloadPct:  0,
    indexed:      0,
    indexTotal:   0,
    vectorCount:  0,
    error:        null,
  };
  private listeners = new Set<() => void>();

  // ── state plumbing ─────────────────────────────────────────────

  getState(): SearchState {
    return this.state;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private patch(p: Partial<SearchState>): void {
    this.state = { ...this.state, ...p };
    for (const cb of this.listeners) cb();
  }

  // ── keyword index ──────────────────────────────────────────────

  initKeyword(): Promise<void> {
    if (this.keywordInit) return this.keywordInit;
    this.keywordInit = (async () => {
      // Purge attach-then-abandoned file rows BEFORE indexing — otherwise
      // their chunks enter the index and can only be dropped at hydrate.
      try { await sweepOrphanFiles(); } catch { /* best-effort */ }
      const docs = await collectAllDocs();
      this.keyword.build(docs);
      this.installHooks();
      this.patch({ keywordReady: true, docCount: this.keyword.size });
    })().catch(err => {
      this.keywordInit = null; // failed boot — let the next call retry
      throw err;
    });
    return this.keywordInit;
  }

  /** Dexie table hooks keep the in-memory index (and the embed queue)
   *  current for every write path — message sends, edits, merges,
   *  collapse-to-one, renames, deletes, imports — without touching any
   *  call site. Hooks run inside the transaction, so they only enqueue;
   *  the debounced flush does the real work afterwards. */
  private installHooks(): void {
    const queueUp = (kind: SearchDocKind) => (rawId: string) => {
      if (kind === "message") this.fileRefCache = null;
      this.pendingUpserts.add(makeDocId(kind, rawId));
      this.scheduleFlush();
    };
    const queueDel = (kind: SearchDocKind) => (rawId: string) => {
      if (kind === "message") this.fileRefCache = null;
      const id = makeDocId(kind, rawId);
      this.pendingUpserts.delete(id);
      this.pendingRemoves.add(id);
      this.scheduleFlush();
    };

    const tables: Array<[SearchDocKind, "chats" | "nodes" | "messages" | "reflections" | "graphNodes"]> = [
      ["chat", "chats"], ["node", "nodes"], ["message", "messages"],
      ["reflection", "reflections"], ["graphNode", "graphNodes"],
    ];
    for (const [kind, table] of tables) {
      const up  = queueUp(kind);
      const del = queueDel(kind);
      db[table].hook("creating", (primKey: string) => { up(primKey); });
      db[table].hook("updating", (_mods: unknown, primKey: string) => { up(primKey); });
      db[table].hook("deleting", (primKey: string) => { del(primKey); });
    }

    // Files expand to one doc per chunk, so they queue by FILE id and the
    // flush reconciles. Rows are immutable after upload — no updating hook.
    const touchFile = (fileId: string) => {
      this.pendingFiles.add(fileId);
      this.scheduleFlush();
    };
    db.files.hook("creating", (primKey: string) => { touchFile(primKey); });
    db.files.hook("deleting", (primKey: string) => { touchFile(primKey); });
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DELAY);
  }

  private async flush(): Promise<void> {
    const removes = [...this.pendingRemoves];
    const upserts = [...this.pendingUpserts];
    const files   = [...this.pendingFiles];
    this.pendingRemoves.clear();
    this.pendingUpserts.clear();
    this.pendingFiles.clear();

    for (const id of removes) {
      const parsed = parseDocId(id);
      const doc = parsed ? await loadDoc(parsed.kind, parsed.rawId) : null;
      if (!doc) {
        this.keyword.remove(id);
        this.embedQueue.delete(id);
        if (this.vectors) await this.vectors.remove(id).catch(() => {});
        continue;
      }
      // Record still exists (delete transaction rolled back after its
      // hook fired) — keep it indexed.
      this.keyword.upsert(doc);
      if (
        EMBEDDED_KINDS.has(doc.kind) &&
        this.vectors &&
        this.vectors.hashOf(id) !== textHash(embedText(doc))
      ) {
        this.embedQueue.add(id);
      }
    }

    for (const id of upserts) {
      const parsed = parseDocId(id);
      if (!parsed) continue;
      const doc = await loadDoc(parsed.kind, parsed.rawId);
      if (!doc) {
        // Vanished between hook and flush (or became unindexable).
        this.keyword.remove(id);
        if (this.vectors) await this.vectors.remove(id).catch(() => {});
        continue;
      }
      this.keyword.upsert(doc);
      if (
        EMBEDDED_KINDS.has(doc.kind) &&
        this.vectors &&
        this.vectors.hashOf(id) !== textHash(embedText(doc))
      ) {
        this.embedQueue.add(id);
      }
    }

    for (const fileId of files) {
      await this.reconcileFileDocs(fileId);
    }

    this.patch({ docCount: this.keyword.size, vectorCount: this.vectors?.size ?? 0 });
    if (this.state.semantic === "ready") void this.pumpEmbeds();
  }

  /** Bring the index in line with one file row: upsert every chunk doc
   *  while the file exists (and isn't an image), remove them all otherwise.
   *  One diff covers create, delete, and delete-rollback. */
  private async reconcileFileDocs(fileId: string): Promise<void> {
    invalidateFileDocCache(fileId);   // never serve stale chunks for a reused id
    const file = await db.files.get(fileId);
    const existing = this.keyword.idsWithPrefix(`f:${fileId}#`);
    const live = new Set<string>();

    if (file && file.kind !== "image") {
      for (const doc of fileChunkDocs(file)) {
        live.add(doc.id);
        this.keyword.upsert(doc);
        if (this.vectors && this.vectors.hashOf(doc.id) !== textHash(embedText(doc))) {
          this.embedQueue.add(doc.id);
        }
      }
    }
    for (const id of existing) {
      if (live.has(id)) continue;
      this.keyword.remove(id);
      this.embedQueue.delete(id);
      if (this.vectors) await this.vectors.remove(id).catch(() => {});
    }
  }

  // ── semantic layer ─────────────────────────────────────────────

  /** Reconcile with prefs. Called at boot and on every prefs change;
   *  handles enable, disable (non-destructive stop — purge is explicit),
   *  and model switches. */
  async configure(opts: { semanticSearch: boolean; embeddingModelId: string }): Promise<void> {
    await this.initKeyword();
    this.lastOpts = opts;

    if (!opts.semanticSearch) {
      this.stopSemantic();
      return;
    }

    const spec = getEmbeddingModel(opts.embeddingModelId);
    if (this.embedder && this.embedder.spec.id !== spec.id) {
      // Model switch: stop, drop the other model's vectors, start fresh.
      this.stopSemantic();
    }
    if (this.embedder) return;   // same model already active/starting
    await VectorStore.wipeOtherModels(spec.id);

    const run = ++this.semanticRun;
    this.patch({ semantic: "starting", modelId: spec.id, error: null, downloadPct: 0 });

    // First start after boot waits for an idle moment so the model
    // download never competes with app startup.
    if (!this.bootDelayUsed) {
      this.bootDelayUsed = true;
      await new Promise<void>(resolve => {
        const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
        if (typeof w.requestIdleCallback === "function") {
          w.requestIdleCallback(() => resolve(), { timeout: BOOT_IDLE_DELAY });
        } else {
          setTimeout(resolve, BOOT_IDLE_DELAY);
        }
      });
      if (run !== this.semanticRun) return;
    }

    const embedder = new LocalEmbedder(spec.id);
    this.embedder = embedder;
    try {
      this.patch({ semantic: "downloading" });
      await embedder.init(pct => {
        if (run === this.semanticRun) this.patch({ downloadPct: pct });
      });
      if (run !== this.semanticRun) { embedder.dispose(); return; }

      const vectors = new VectorStore(spec.id);
      await vectors.load();
      if (run !== this.semanticRun) { embedder.dispose(); return; }
      this.vectors = vectors;

      await this.backfill(run);
      if (run !== this.semanticRun) return;

      this.patch({ semantic: "ready", vectorCount: this.vectors.size });
      void this.pumpEmbeds();
    } catch (err) {
      if (run !== this.semanticRun) return;
      console.warn("[search] semantic layer failed:", err);
      this.embedder?.dispose();
      this.embedder = null;
      this.vectors = null;
      this.patch({
        semantic: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      // Transient network blips are the common failure — retry once on our
      // own after a pause; after that it's the user's Retry button.
      if (!this.autoRetryDone) {
        this.autoRetryDone = true;
        setTimeout(() => {
          if (this.state.semantic === "error") void this.retrySemantic();
        }, 20_000);
      }
    }
  }

  /** Tear down a failed/stuck semantic layer and start over with the same
   *  prefs. Safe to call any time; no-op when semantic is disabled. */
  async retrySemantic(): Promise<void> {
    const opts = this.lastOpts;
    if (!opts || !opts.semanticSearch) return;
    this.stopSemantic();
    await this.configure(opts);
  }

  /** Stop the semantic layer without deleting anything. */
  stopSemantic(): void {
    this.semanticRun++;
    this.embedder?.dispose();
    this.embedder = null;
    this.vectors = null;
    this.embedQueue.clear();
    this.patch({ semantic: "off", downloadPct: 0, indexed: 0, indexTotal: 0, vectorCount: 0 });
  }

  /** Destructive companion to disabling the pref: drop all vectors and
   *  the cached model weights. */
  async purgeSemanticData(): Promise<void> {
    this.stopSemantic();
    await VectorStore.wipeAll();
    try {
      await caches.delete("transformers-cache");
    } catch { /* Cache API unavailable — nothing cached then */ }
  }

  /** Embed every doc that's missing a vector or whose content changed;
   *  drop vectors whose docs are gone. */
  private async backfill(run: number): Promise<void> {
    if (!this.vectors || !this.embedder) return;
    const docs = (await collectAllDocs())
      .filter(d => EMBEDDED_KINDS.has(d.kind));

    const liveIds = new Set(docs.map(d => d.id));
    const orphans = this.vectors.ids().filter(id => !liveIds.has(id));
    await this.vectors.removeMany(orphans);

    const needs = docs.filter(d => this.vectors!.hashOf(d.id) !== textHash(embedText(d)));
    this.patch({ semantic: "indexing", indexed: 0, indexTotal: needs.length });

    for (let i = 0; i < needs.length; i += EMBED_BATCH) {
      if (run !== this.semanticRun) return;
      const batch = needs.slice(i, i + EMBED_BATCH);
      const texts = batch.map(embedText);
      const vecs  = await this.embedder.embedDocs(texts);
      for (let j = 0; j < batch.length; j++) {
        const doc = batch[j]!;
        const vec = vecs[j];
        if (!vec) continue;
        await this.vectors.upsert({
          docId:    doc.id,
          kind:     doc.kind as EmbeddedKind,
          chatId:   doc.chatId,
          nodeId:   doc.nodeId,
          textHash: textHash(embedText(doc)),
          vector:   vec,
        });
      }
      this.patch({
        indexed:     Math.min(i + batch.length, needs.length),
        vectorCount: this.vectors.size,
      });
      if (i + EMBED_BATCH < needs.length) await sleep(EMBED_BATCH_REST);
    }
  }

  /** Drain the incremental embed queue (post-backfill writes). */
  private async pumpEmbeds(): Promise<void> {
    if (this.pumping || !this.embedder || !this.vectors) return;
    this.pumping = true;
    let inflight: string[] = [];
    try {
      while (this.embedQueue.size > 0 && this.state.semantic === "ready") {
        inflight = [...this.embedQueue].slice(0, EMBED_BATCH);
        for (const id of inflight) this.embedQueue.delete(id);
        const docs: SearchDoc[] = [];
        for (const id of inflight) {
          const parsed = parseDocId(id);
          if (!parsed) continue;
          const doc = await loadDoc(parsed.kind, parsed.rawId);
          if (doc && EMBEDDED_KINDS.has(doc.kind)) docs.push(doc);
        }
        if (docs.length > 0) {
          const vecs = await this.embedder.embedDocs(docs.map(embedText));
          for (let i = 0; i < docs.length; i++) {
            const doc = docs[i]!;
            const vec = vecs[i];
            if (!vec) continue;
            await this.vectors.upsert({
              docId:    doc.id,
              kind:     doc.kind as EmbeddedKind,
              chatId:   doc.chatId,
              nodeId:   doc.nodeId,
              textHash: textHash(embedText(doc)),
              vector:   vec,
            });
          }
          this.patch({ vectorCount: this.vectors.size });
        }
        inflight = [];
        await sleep(EMBED_BATCH_REST);
      }
    } catch (err) {
      if (this.state.semantic === "ready") for (const id of inflight) this.embedQueue.add(id);
      console.warn("[search] incremental embed failed:", err);
    } finally {
      this.pumping = false;
    }
  }

  // ── graph-scoped retrieval primitives (lib/graphrag) ───────────

  /** Raw keyword hits for corpus-scoped retrieval. The default limit is
   *  high because the caller filters down to a (possibly tiny) corpus —
   *  a global top-80 could be entirely out-of-corpus. */
  async keywordHits(
    query: string,
    limit = 200,
    filter?: (id: string) => boolean,
  ): Promise<KeywordHit[]> {
    await this.initKeyword();
    return this.keyword.search(query, limit, filter);
  }

  /** Semantic hits restricted to `allowed` doc ids — or null when the
   *  semantic layer is off / still warming / empty, so callers degrade
   *  to keyword-only ranking. */
  async semanticHitsScoped(
    query: string,
    allowed: Set<string>,
    k = 50,
  ): Promise<VectorHit[] | null> {
    if (
      this.state.semantic !== "ready" ||
      !this.embedder || !this.vectors || this.vectors.size === 0
    ) {
      return null;
    }
    try {
      const qVec = await this.embedder.embedQuery(query);
      return this.vectors.searchScoped(qVec, allowed, k);
    } catch (err) {
      console.warn("[search] scoped query embedding failed — keyword only:", err);
      return null;
    }
  }

  // ── querying ───────────────────────────────────────────────────

  async search(query: string, limit = 40): Promise<SearchResponse> {
    const started = performance.now();
    const q = query.trim();
    await this.initKeyword();
    if (!q) return { query, hits: [], tookMs: 0 };

    const keywordHits = this.keyword.search(q, 80);
    const termsByDoc = new Map<string, string[]>(keywordHits.map(h => [h.id, h.terms]));

    let semanticIds: string[] = [];
    if (this.state.semantic === "ready" && this.embedder && this.vectors && this.vectors.size > 0) {
      try {
        const qVec = await this.embedder.embedQuery(q);
        semanticIds = this.vectors.search(qVec, 50).map(h => h.id);
      } catch (err) {
        console.warn("[search] query embedding failed — keyword only:", err);
      }
    }

    const fused = rrfFuse([keywordHits.map(h => h.id), semanticIds]);
    // Over-fetch: hydrate drops unresolvable rows (vanished records,
    // unreferenced files, the per-file chunk cap) — slicing to `limit`
    // first would silently return short result lists.
    const top = fused.slice(0, limit * 3);

    const hits = await this.hydrate(top.map(f => ({
      docId:   f.id,
      score:   f.score,
      sources: f.sources.map(s => (s === 0 ? "keyword" : "semantic") as HitSource),
      terms:   termsByDoc.get(f.id) ?? tokenizeQuery(q),
    })));

    return { query, hits: hits.slice(0, limit), tookMs: Math.round(performance.now() - started) };
  }

  private async hydrate(
    rows: Array<{ docId: string; score: number; sources: HitSource[]; terms: string[] }>,
  ): Promise<ResolvedHit[]> {
    const byKind = new Map<SearchDocKind, string[]>();
    for (const r of rows) {
      const parsed = parseDocId(r.docId);
      if (!parsed) continue;
      const arr = byKind.get(parsed.kind) ?? [];
      arr.push(parsed.rawId);
      byKind.set(parsed.kind, arr);
    }

    const [messages, reflections, nodes, graphNodes, chats, graphs] = await Promise.all([
      db.messages.bulkGet(byKind.get("message") ?? []),
      db.reflections.bulkGet(byKind.get("reflection") ?? []),
      db.nodes.bulkGet(byKind.get("node") ?? []),
      db.graphNodes.bulkGet(byKind.get("graphNode") ?? []),
      db.chats.toArray(),
      db.graphs.toArray(),
    ]);
    const msgById   = new Map(messages.filter(Boolean).map(m => [m!._id, m!]));
    const refById   = new Map(reflections.filter(Boolean).map(r => [r!._id, r!]));
    const nodeById  = new Map(nodes.filter(Boolean).map(n => [n!._id, n!]));
    const gnById    = new Map(graphNodes.filter(Boolean).map(g => [g!._id, g!]));
    const chatById  = new Map(chats.map(c => [c._id, c]));
    const graphById = new Map(graphs.map(g => [g._id, g]));

    // fileChunk hits resolve navigation lazily: files carry no back-
    // reference, so scan messages (only when such hits exist) for the
    // EARLIEST non-dock message that attached each file. Hits whose file
    // has no live non-dock reference are dropped — nothing to open. The
    // scan result is cached on the service (invalidated by message writes)
    // so typing in the search box doesn't re-read the table per keystroke.
    const fileById  = new Map<string, StoredFile>();
    let fileRef: Map<string, FileRef> = new Map();
    const fileRawIds = byKind.get("fileChunk") ?? [];
    if (fileRawIds.length > 0) {
      const fileIds = [...new Set(
        fileRawIds.map(raw => parseFileChunkRawId(raw)?.fileId)
          .filter((x): x is string => Boolean(x)),
      )];
      const files = await db.files.bulkGet(fileIds);
      for (const f of files) if (f) fileById.set(f._id, f);
      if (!this.fileRefCache) {
        const cache = new Map<string, FileRef>();
        for (const m of await db.messages.toArray()) {
          if (!m.fileIds?.length) continue;
          const chat = chatById.get(m.chatId);
          if (!chat || chat.graphId) continue;   // dock chats stay un-navigable
          for (const fid of m.fileIds) {
            const prev = cache.get(fid);
            if (!prev || m.createdAt < prev.createdAt) {
              cache.set(fid, { chatId: m.chatId, nodeId: m.nodeId, messageId: m._id, createdAt: m.createdAt });
            }
          }
        }
        this.fileRefCache = cache;
      }
      fileRef = this.fileRefCache;
    }
    const fileHitCount = new Map<string, number>();

    const out: ResolvedHit[] = [];
    for (const r of rows) {
      const parsed = parseDocId(r.docId);
      if (!parsed) continue;
      const base = { docId: r.docId, rawId: parsed.rawId, score: r.score, sources: r.sources };

      if (parsed.kind === "message") {
        const m = msgById.get(parsed.rawId);
        const chat = m && chatById.get(m.chatId);
        if (!m || !chat) continue;
        out.push({
          ...base, kind: "message", chatId: m.chatId, nodeId: m.nodeId,
          chatTitle: chat.title, title: "",
          snippet: makeSnippet(m.content, r.terms), role: m.role,
        });
      } else if (parsed.kind === "reflection") {
        const ref = refById.get(parsed.rawId);
        const chat = ref && chatById.get(ref.chatId);
        if (!ref || !chat) continue;
        out.push({
          ...base, kind: "reflection", chatId: ref.chatId, nodeId: ref.nodeId,
          chatTitle: chat.title, title: ref.title,
          snippet: makeSnippet(ref.body, r.terms),
        });
      } else if (parsed.kind === "graphNode") {
        const g = gnById.get(parsed.rawId);
        const graph = g && graphById.get(g.graphId);
        if (!g || !graph) continue;
        out.push({
          ...base, kind: "graphNode", chatId: g.graphId, nodeId: "",
          chatTitle: graph.name, title: g.label,
          snippet: g.notes ? makeSnippet(g.notes, r.terms) : null,
        });
      } else if (parsed.kind === "node") {
        const n = nodeById.get(parsed.rawId);
        const chat = n && chatById.get(n.chatId);
        if (!n || !chat) continue;
        out.push({
          ...base, kind: "node", chatId: n.chatId, nodeId: n._id,
          chatTitle: chat.title, title: n.label, snippet: null,
        });
      } else if (parsed.kind === "fileChunk") {
        const fc   = parseFileChunkRawId(parsed.rawId);
        const file = fc ? fileById.get(fc.fileId) : undefined;
        const ref  = fc ? fileRef.get(fc.fileId) : undefined;
        if (!fc || !file || !ref) continue;
        if ((fileHitCount.get(fc.fileId) ?? 0) >= FILE_HITS_PER_FILE) continue;
        const chunk = chunksForFile(fc.fileId, file.content)[fc.chunkIndex];
        if (!chunk) continue;
        fileHitCount.set(fc.fileId, (fileHitCount.get(fc.fileId) ?? 0) + 1);
        out.push({
          ...base, kind: "fileChunk", chatId: ref.chatId, nodeId: ref.nodeId,
          chatTitle: chatById.get(ref.chatId)?.title ?? "", title: file.name,
          snippet: makeSnippet(chunk.text, r.terms),
          messageId: ref.messageId,
        });
      } else {
        const chat = chatById.get(parsed.rawId);
        if (!chat) continue;
        out.push({
          ...base, kind: "chat", chatId: chat._id,
          nodeId: chat.currentNodeId || chat.rootNodeId,
          chatTitle: chat.title, title: chat.title, snippet: null,
        });
      }
    }
    return out;
  }
}

export const searchService = new SearchService();