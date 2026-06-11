// src/lib/search/vectorStore.ts
// In-memory matrix of document embeddings + brute-force retrieval.
// Vectors are pre-normalized, so cosine similarity = dot product; a flat
// Float32Array scan handles tens of thousands of 384-dim vectors in
// single-digit milliseconds — no ANN index needed at this scale.
// Dexie's `searchVectors` table is the persistent backing; this class is
// the hot copy used at query time.

import { db, type SearchVector } from "../db";

export interface VectorHit {
  id:    string;
  score: number;
}

export interface VectorRowInput {
  docId:    string;
  kind:     "message" | "reflection" | "graphNode";
  chatId:   string;
  nodeId:   string;
  textHash: string;
  vector:   Float32Array;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Top-k by dot product over an iterable of rows. Pure — unit-testable. */
export function topKByDot(
  query: Float32Array,
  rows: Iterable<{ id: string; vector: Float32Array }>,
  k: number,
): VectorHit[] {
  if (k <= 0) return [];
  const hits: VectorHit[] = [];
  for (const row of rows) {
    if (row.vector.length !== query.length) continue;
    const score = dot(query, row.vector);
    if (hits.length < k) {
      hits.push({ id: row.id, score });
      if (hits.length === k) hits.sort((a, b) => a.score - b.score);
      continue;
    }
    if (score > hits[0]!.score) {
      hits[0] = { id: row.id, score };
      // Re-bubble the new minimum to the front.
      hits.sort((a, b) => a.score - b.score);
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

export class VectorStore {
  private rows = new Map<string, { id: string; vector: Float32Array; textHash: string }>();
  private model: string;

  constructor(model: string) {
    this.model = model;
  }

  get size(): number {
    return this.rows.size;
  }

  /** Pull this model's rows from Dexie into memory. */
  async load(): Promise<void> {
    const stored = await db.searchVectors.where("model").equals(this.model).toArray();
    this.rows.clear();
    for (const r of stored) {
      this.rows.set(r._id, { id: r._id, vector: new Float32Array(r.vector), textHash: r.textHash });
    }
  }

  hashOf(docId: string): string | undefined {
    return this.rows.get(docId)?.textHash;
  }

  ids(): string[] {
    return [...this.rows.keys()];
  }

  async upsert(input: VectorRowInput): Promise<void> {
    const record: SearchVector = {
      _id:       input.docId,
      kind:      input.kind,
      chatId:    input.chatId,
      nodeId:    input.nodeId,
      model:     this.model,
      dims:      input.vector.length,
      // Slice so the stored buffer is exactly this vector (the source may
      // be a view into a larger transferred batch buffer).
      vector:    input.vector.slice().buffer,
      textHash:  input.textHash,
      updatedAt: Date.now(),
    };
    await db.searchVectors.put(record);
    this.rows.set(input.docId, { id: input.docId, vector: input.vector.slice(), textHash: input.textHash });
  }

  async remove(docId: string): Promise<void> {
    await db.searchVectors.delete(docId);
    this.rows.delete(docId);
  }

  async removeMany(docIds: string[]): Promise<void> {
    if (docIds.length === 0) return;
    await db.searchVectors.bulkDelete(docIds);
    for (const id of docIds) this.rows.delete(id);
  }

  search(query: Float32Array, k: number): VectorHit[] {
    return topKByDot(query, this.rows.values(), k);
  }

  /** Top-k restricted to an allowed doc-id set — graph-scoped retrieval
   *  ranks ONLY the content attached to one graph's nodes. */
  searchScoped(query: Float32Array, allowed: Set<string>, k: number): VectorHit[] {
    const filtered: Array<{ id: string; vector: Float32Array }> = [];
    for (const row of this.rows.values()) {
      if (allowed.has(row.id)) filtered.push(row);
    }
    return topKByDot(query, filtered, k);
  }

  /** Wipe ALL stored vectors (every model) — used by "disable semantic". */
  static async wipeAll(): Promise<void> {
    await db.searchVectors.clear();
  }

  /** Wipe rows belonging to other models (after a model switch). */
  static async wipeOtherModels(keep: string): Promise<void> {
    await db.searchVectors.where("model").notEqual(keep).delete();
  }
}