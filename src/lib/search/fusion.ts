// src/lib/search/fusion.ts
// Reciprocal-rank fusion: combines independently-ranked result lists
// (keyword BM25, semantic cosine) without having to normalize their
// incompatible score scales. score(d) = Σ over lists 1/(k + rank_d).
// Documents found by both retrievers naturally rise to the top.

export const RRF_K = 60;

export interface FusedHit {
  id:      string;
  score:   number;
  /** Which source lists ranked this doc (by index into the input array). */
  sources: number[];
}

export function rrfFuse(lists: string[][], k: number = RRF_K): FusedHit[] {
  const byId = new Map<string, FusedHit>();
  lists.forEach((list, listIdx) => {
    list.forEach((id, rank) => {
      const inc = 1 / (k + rank + 1);
      const cur = byId.get(id);
      if (cur) {
        cur.score += inc;
        if (!cur.sources.includes(listIdx)) cur.sources.push(listIdx);
      } else {
        byId.set(id, { id, score: inc, sources: [listIdx] });
      }
    });
  });
  return [...byId.values()].sort((a, b) =>
    b.score - a.score || a.id.localeCompare(b.id));
}