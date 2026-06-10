// src/lib/search/keywordIndex.ts
// BM25 keyword index over search docs, wrapping MiniSearch. In-memory and
// rebuilt from Dexie at boot (tens of ms at beta scale) — no serialized
// index to drift out of sync. Incremental upsert/remove keeps it current
// within a session.

import MiniSearch, { type SearchResult } from "minisearch";
import type { SearchDoc } from "./docs";

export interface KeywordHit {
  id:    string;
  score: number;
  /** Query terms that matched this doc (for snippet highlighting). */
  terms: string[];
}

interface IndexedDoc {
  id:     string;
  title:  string;
  text:   string;
}

export class KeywordIndex {
  private mini: MiniSearch<IndexedDoc>;
  /** Docs currently in the index — MiniSearch.remove() needs the old doc. */
  private docs = new Map<string, IndexedDoc>();

  constructor() {
    this.mini = new MiniSearch<IndexedDoc>({
      fields: ["title", "text"],
      storeFields: [],
      searchOptions: {
        boost: { title: 2.5 },
        prefix: true,
        fuzzy: 0.15,
      },
    });
  }

  get size(): number {
    return this.docs.size;
  }

  build(docs: SearchDoc[]): void {
    this.mini.removeAll();
    this.docs.clear();
    const slim = docs.map(d => ({ id: d.id, title: d.title, text: d.text }));
    for (const d of slim) this.docs.set(d.id, d);
    this.mini.addAll(slim);
  }

  upsert(doc: SearchDoc): void {
    this.remove(doc.id);
    const slim: IndexedDoc = { id: doc.id, title: doc.title, text: doc.text };
    this.docs.set(doc.id, slim);
    this.mini.add(slim);
  }

  remove(id: string): void {
    const prev = this.docs.get(id);
    if (!prev) return;
    this.mini.remove(prev);
    this.docs.delete(id);
  }

  search(query: string, limit = 80): KeywordHit[] {
    const q = query.trim();
    if (!q) return [];
    const results: SearchResult[] = this.mini.search(q);
    return results.slice(0, limit).map(r => ({
      id:    String(r.id),
      score: r.score,
      terms: r.terms,
    }));
  }
}