// src/lib/docrag/retrieve.ts
// Document-scoped retrieval for large uploaded files: the path's stubbed
// files define the corpus (an allow-list of their chunk doc ids), the
// existing hybrid engine ranks inside it, and the top excerpts ride to the
// model in system context. Degrades to keyword-only while the semantic
// layer is off or warming — mirror of graphrag/retrieve.ts without the
// graph-proximity re-weighting (chunks have no structure to traverse).

import { db, type StoredFile } from "../db";
import { searchService } from "../search/service";
import { fileChunkDocId, parseDocId, parseFileChunkRawId } from "../search/docs";
import { rrfFuse } from "../search/fusion";
import type { KeywordHit } from "../search/keywordIndex";
import type { VectorHit } from "../search/vectorStore";
import { chunksForFile, type FileChunk } from "./chunk";

const FILE_KEYWORD_POOL = 200;  // global pool — the allow-list may be tiny
const FILE_KEYWORD_KEEP = 40;
const FILE_SEMANTIC_K   = 24;
export const FILE_MAX_EXCERPTS = 12;
/** Blank query (files-only send): no signal to rank on — surface each
 *  document's opening chunks instead of nothing. */
const BLANK_QUERY_CHUNKS_PER_FILE = 3;

export interface FileExcerpt {
  docId:      string;
  fileId:     string;
  chunkIndex: number;
  fileName:   string;
  text:       string;
  score:      number;
}

export interface FileRetrievalResult {
  query:    string;
  excerpts: FileExcerpt[];
  /** Every stubbed (non-image, still-existing) file on the path — listed
   *  even when nothing matched, so the prompt can name what exists. */
  files: Array<{ fileId: string; name: string; chars: number; chunkCount: number }>;
  semanticUsed: boolean;
  /** False when the excerpts are document OPENINGS rather than question
   *  matches (blank query, or nothing matched — e.g. the index is still
   *  warming for a just-attached file). The prompt says so. */
  matchedQuery: boolean;
}

/** Pure ranking core: keyword hits filtered to the allowed chunk ids,
 *  RRF-fused with the (already-scoped) semantic hits. */
export function rankFileHits(
  kw:      KeywordHit[],
  sem:     VectorHit[] | null,
  allowed: Set<string>,
): Array<{ docId: string; score: number }> {
  const kwIds = kw
    .filter(h => allowed.has(h.id))
    .slice(0, FILE_KEYWORD_KEEP)
    .map(h => h.id);
  const semIds = (sem ?? []).map(h => h.id);
  return rrfFuse([kwIds, semIds]).map(f => ({ docId: f.id, score: f.score }));
}

export async function retrieveForFiles(
  fileIds: string[],
  query:   string,
): Promise<FileRetrievalResult> {
  const q = query.trim();
  const rows = await db.files.bulkGet(fileIds);
  const files = rows.filter((f): f is StoredFile => Boolean(f) && f!.kind !== "image");

  const chunksByFile = new Map<string, FileChunk[]>();
  const allowed = new Set<string>();
  for (const f of files) {
    const chunks = chunksForFile(f._id, f.content);
    chunksByFile.set(f._id, chunks);
    for (const c of chunks) allowed.add(fileChunkDocId(f._id, c.index));
  }

  const fileMeta = files.map(f => ({
    fileId: f._id, name: f.name, chars: f.content.length,
    chunkCount: chunksByFile.get(f._id)?.length ?? 0,
  }));

  if (files.length === 0 || allowed.size === 0) {
    return { query: q, excerpts: [], files: fileMeta, semanticUsed: false, matchedQuery: false };
  }

  // Document openings — the fallback when there's no signal to rank on
  // (blank query, or the index hasn't caught up with a fresh upload yet).
  const openingExcerpts = (): FileExcerpt[] => {
    const excerpts: FileExcerpt[] = [];
    for (const f of files) {
      for (const c of (chunksByFile.get(f._id) ?? []).slice(0, BLANK_QUERY_CHUNKS_PER_FILE)) {
        excerpts.push({
          docId: fileChunkDocId(f._id, c.index), fileId: f._id,
          chunkIndex: c.index, fileName: f.name, text: c.text, score: 0,
        });
      }
    }
    return excerpts.slice(0, FILE_MAX_EXCERPTS);
  };

  if (!q) {
    return {
      query: q, excerpts: openingExcerpts(),
      files: fileMeta, semanticUsed: false, matchedQuery: false,
    };
  }

  // Allow-list INSIDE the pool: on a chat-heavy workspace, out-of-corpus
  // message docs must not eat the 200 slots before the corpus filter.
  const kw  = await searchService.keywordHits(q, FILE_KEYWORD_POOL, id => allowed.has(id));
  const sem = await searchService.semanticHitsScoped(q, allowed, FILE_SEMANTIC_K);
  const ranked = rankFileHits(kw, sem, allowed).slice(0, FILE_MAX_EXCERPTS);

  if (ranked.length === 0) {
    return {
      query: q, excerpts: openingExcerpts(),
      files: fileMeta, semanticUsed: sem !== null, matchedQuery: false,
    };
  }

  const nameById = new Map(files.map(f => [f._id, f.name]));
  const excerpts: FileExcerpt[] = [];
  for (const r of ranked) {
    const doc = parseDocId(r.docId);
    if (doc?.kind !== "fileChunk") continue;
    const parsed = parseFileChunkRawId(doc.rawId);
    if (!parsed) continue;
    const chunk = chunksByFile.get(parsed.fileId)?.[parsed.chunkIndex];
    const name  = nameById.get(parsed.fileId);
    if (!chunk || !name) continue;
    excerpts.push({
      docId: r.docId, fileId: parsed.fileId, chunkIndex: parsed.chunkIndex,
      fileName: name, text: chunk.text, score: r.score,
    });
  }

  return { query: q, excerpts, files: fileMeta, semanticUsed: sem !== null, matchedQuery: true };
}
