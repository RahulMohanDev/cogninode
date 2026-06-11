// src/lib/graphrag/retrieve.ts
// Graph-scoped retrieval: the graph defines the corpus, the existing
// hybrid search engine ranks inside it, and graph traversal re-weights —
// content attached nearer the root wins ties. Degrades to keyword-only
// when the semantic layer is off or still warming.
//
//   question
//      │  BM25 + (optional) embeddings — existing search service
//      ▼
//   rank ONLY this graph's docs  →  RRF fuse
//      ▼
//   score / (1 + α · distFromRoot(owner))     α = 0.15
//      ▼
//   top blocks, hydrated + truncated

import { db } from "../db";
import { searchService } from "../search/service";
import { parseDocId } from "../search/docs";
import { rrfFuse } from "../search/fusion";
import type { KeywordHit } from "../search/keywordIndex";
import type { VectorHit } from "../search/vectorStore";
import { resolveCorpus, type GraphCorpus } from "./corpus";

export const PROXIMITY_ALPHA = 0.15;
export const MAX_BLOCKS      = 24;
export const MAX_BLOCK_CHARS = 2400;   // ~600 tokens per excerpt
const KEYWORD_POOL = 200;              // pre-filter pool (corpus may be tiny)
const KEYWORD_KEEP = 80;
const SEMANTIC_K   = 50;

export interface RankedDoc {
  docId:       string;
  graphNodeId: string;
  score:       number;
}

export interface RetrievedBlock {
  docId:       string;
  graphNodeId: string;
  kind:        "message" | "reflection" | "graphNode";
  /** Reflection title / graph-node label — "" for messages. */
  title:       string;
  text:        string;
  role?:       "user" | "assistant";
  score:       number;
}

export interface RetrievalResult {
  query:        string;
  blocks:       RetrievedBlock[];
  corpus:       GraphCorpus | null;
  semanticUsed: boolean;
}

/** Pure ranking core: filter to the corpus, RRF-fuse the engines, then
 *  re-weight by the owning node's BFS distance from the root. */
export function rankCorpusHits(
  kw:     KeywordHit[],
  sem:    VectorHit[] | null,
  corpus: GraphCorpus,
): RankedDoc[] {
  const kwIds = kw
    .filter(h => corpus.docIds.has(h.id))
    .slice(0, KEYWORD_KEEP)
    .map(h => h.id);
  const semIds = (sem ?? []).map(h => h.id);   // already corpus-scoped

  const out: RankedDoc[] = [];
  for (const f of rrfFuse([kwIds, semIds])) {
    const owner = corpus.docToGraphNode.get(f.id);
    if (!owner) continue;
    const dist = corpus.distFromRoot.get(owner) ?? 0;
    out.push({
      docId:       f.id,
      graphNodeId: owner,
      score:       f.score / (1 + PROXIMITY_ALPHA * dist),
    });
  }
  return out.sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId));
}

export async function retrieveForGraph(
  graphId: string,
  query:   string,
): Promise<RetrievalResult> {
  const q = query.trim();
  const corpus = await resolveCorpus(graphId);
  if (!corpus || !q || corpus.docIds.size === 0) {
    return { query: q, blocks: [], corpus, semanticUsed: false };
  }

  const kw  = await searchService.keywordHits(q, KEYWORD_POOL);
  const sem = await searchService.semanticHitsScoped(q, corpus.docIds, SEMANTIC_K);
  const ranked = rankCorpusHits(kw, sem, corpus).slice(0, MAX_BLOCKS);

  // Hydrate — tolerate rows that vanished between corpus build and now.
  const msgIds: string[] = [];
  const reflIds: string[] = [];
  for (const r of ranked) {
    const parsed = parseDocId(r.docId);
    if (parsed?.kind === "message") msgIds.push(parsed.rawId);
    else if (parsed?.kind === "reflection") reflIds.push(parsed.rawId);
  }
  const [messages, reflections] = await Promise.all([
    db.messages.bulkGet(msgIds),
    db.reflections.bulkGet(reflIds),
  ]);
  const msgById  = new Map(messages.filter(Boolean).map(m => [m!._id, m!]));
  const reflById = new Map(reflections.filter(Boolean).map(r => [r!._id, r!]));

  const blocks: RetrievedBlock[] = [];
  for (const r of ranked) {
    const parsed = parseDocId(r.docId);
    if (!parsed) continue;
    if (parsed.kind === "message") {
      const m = msgById.get(parsed.rawId);
      if (!m || !m.content.trim()) continue;
      blocks.push({
        docId: r.docId, graphNodeId: r.graphNodeId, kind: "message",
        title: "", text: m.content.slice(0, MAX_BLOCK_CHARS),
        role: m.role, score: r.score,
      });
    } else if (parsed.kind === "reflection") {
      const refl = reflById.get(parsed.rawId);
      if (!refl) continue;
      blocks.push({
        docId: r.docId, graphNodeId: r.graphNodeId, kind: "reflection",
        title: refl.title, text: refl.body.slice(0, MAX_BLOCK_CHARS),
        score: r.score,
      });
    } else if (parsed.kind === "graphNode") {
      const n = corpus.nodesById.get(parsed.rawId);
      if (!n || !n.notes.trim()) continue;   // bare labels carry no body to quote
      blocks.push({
        docId: r.docId, graphNodeId: r.graphNodeId, kind: "graphNode",
        title: n.label, text: n.notes.slice(0, MAX_BLOCK_CHARS),
        score: r.score,
      });
    }
  }

  return { query: q, blocks, corpus, semanticUsed: sem !== null };
}
