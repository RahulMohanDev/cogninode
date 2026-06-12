// src/lib/docrag/chunk.ts
// Pure chunking for uploaded-document retrieval ("file RAG") + the shared
// size constants that govern when a file is inlined vs indexed. Chunks are
// derived on demand from the immutable StoredFile.content — they are never
// persisted, so the chunker IS the source of truth for `f:<fileId>#<n>`
// doc ids and must stay deterministic.

/** Files at or under this many chars inline in full on every turn. */
export const INLINE_MAX_CHARS = 12_000;
/** Shared budget for the turn files are attached: large files inline in
 *  full until the turn's TOTAL inlined large-file chars would exceed this;
 *  past it (or alone over it) they get the stub + retrieved excerpts. */
export const ATTACH_TURN_CAP_CHARS = 60_000;
/** Head-of-document preview included in the stub block. */
export const STUB_HEAD_CHARS = 600;

/** Chunk bodies target the embedder's EMBED_MAX_CHARS=1500 window. Not a
 *  hard guarantee: a merged tail can reach CHUNK_MAX_CHARS+CHUNK_MIN_CHARS
 *  −1 chars and chunk 0 carries the file-name title line, so the last
 *  ~100 chars of an over-window chunk embed clipped — keyword search
 *  still indexes the full text. */
export const CHUNK_MAX_CHARS = 1_400;
export const CHUNK_OVERLAP_CHARS = 200;
/** Tails shorter than this merge into the previous chunk. */
export const CHUNK_MIN_CHARS = 200;
/** Safety valve (~2.8MB of text) for the keyword/embedding workload. */
export const MAX_CHUNKS_PER_FILE = 2_000;

/** Never cut earlier than this offset into a full window — guarantees
 *  forward progress past the overlap and keeps chunks reasonably sized. */
const MIN_CUT = Math.floor(CHUNK_MAX_CHARS / 2);

export interface FileChunk {
  index: number;
  /** [start, end) into the original file content. */
  start: number;
  end:   number;
  text:  string;
}

/** Pick where to end the chunk that starts at `pos`. Prefers, in order:
 *  paragraph break, line break, sentence end, word break — falling back
 *  to a hard cut at the window edge. */
function cutPoint(text: string, pos: number): number {
  const windowEnd = Math.min(pos + CHUNK_MAX_CHARS, text.length);
  if (windowEnd === text.length) return windowEnd;

  const window = text.slice(pos, windowEnd);
  for (const [sep, keep] of [["\n\n", 2], ["\n", 1], [". ", 2], [" ", 1]] as const) {
    const idx = window.lastIndexOf(sep);
    if (idx >= MIN_CUT) return pos + idx + keep;
  }
  return windowEnd;
}

/** Split file text into overlapping, boundary-aligned chunks. Coverage is
 *  total: the union of [start, end) ranges is the whole input. */
export function chunkFileText(text: string): FileChunk[] {
  if (!text.trim()) return [];

  const chunks: FileChunk[] = [];
  let pos = 0;
  while (pos < text.length && chunks.length < MAX_CHUNKS_PER_FILE) {
    const end = cutPoint(text, pos);
    chunks.push({ index: chunks.length, start: pos, end, text: text.slice(pos, end) });
    if (end >= text.length) break;
    // Overlap can't stall: every non-final cut sits ≥ MIN_CUT past pos.
    pos = end - CHUNK_OVERLAP_CHARS;
  }

  // Merge an undersized tail into its predecessor.
  const last = chunks[chunks.length - 1];
  const prev = chunks[chunks.length - 2];
  if (last && prev && last.end - prev.end < CHUNK_MIN_CHARS) {
    prev.end  = last.end;
    prev.text = text.slice(prev.start, last.end);
    chunks.pop();
  }

  return chunks;
}

// ── per-file memo ──────────────────────────────────────────────────
// pumpEmbeds loads chunk docs one at a time through loadDoc; without a
// memo each load would re-chunk the whole file. File content is immutable
// after upload, so fileId alone is a safe key (content length double-
// checks against id reuse in tests/imports).

const MEMO_MAX = 8;
const memo = new Map<string, { contentLength: number; chunks: FileChunk[] }>();

export function chunksForFile(fileId: string, content: string): FileChunk[] {
  const hit = memo.get(fileId);
  if (hit && hit.contentLength === content.length) {
    memo.delete(fileId);                 // refresh LRU position
    memo.set(fileId, hit);
    return hit.chunks;
  }
  const chunks = chunkFileText(content);
  memo.set(fileId, { contentLength: content.length, chunks });
  if (memo.size > MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  return chunks;
}

/** Drop a file's memoized chunks — call when its row is deleted (or
 *  replaced by an import), so a reused id can never serve stale chunks. */
export function invalidateChunkMemo(fileId: string): void {
  memo.delete(fileId);
}
