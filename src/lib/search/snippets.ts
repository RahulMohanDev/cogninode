// src/lib/search/snippets.ts
// Result-row snippets: collapse whitespace, window the text around the
// first matched term, and report highlight ranges (relative to the
// snippet) so the UI can <mark> them without re-searching.

export interface Snippet {
  text:      string;
  /** [start, end) ranges into `text` to highlight. Non-overlapping, sorted. */
  ranges:    Array<[number, number]>;
  /** True when the snippet starts after the beginning of the source. */
  leading:   boolean;
  trailing:  boolean;
}

const WINDOW = 160;

/** Collapse markdown-ish noise into a single line of plain-ish text. */
export function collapseText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[#>*_|-]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findTermRanges(haystackLower: string, terms: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    const t = term.toLowerCase();
    if (t.length < 2) continue;
    let from = 0;
    while (true) {
      const at = haystackLower.indexOf(t, from);
      if (at === -1) break;
      ranges.push([at, at + t.length]);
      from = at + t.length;
      if (ranges.length > 64) break;   // pathological inputs
    }
  }
  // Sort + merge overlaps so the UI can render in one pass.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

export function makeSnippet(raw: string, terms: string[], window: number = WINDOW): Snippet {
  const text = collapseText(raw);
  const lower = text.toLowerCase();
  const all = findTermRanges(lower, terms);

  // No term hit (semantic-only result, or terms only matched the title):
  // lead with the opening of the text.
  const anchor = all.length > 0 ? all[0]![0] : 0;

  let start = Math.max(0, anchor - Math.floor(window / 3));
  let end   = Math.min(text.length, start + window);
  start     = Math.max(0, Math.min(start, end - window));

  // Snap to word boundaries where cheap.
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp !== -1 && sp < start + 20) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp > end - 20) end = sp;
  }

  const ranges: Array<[number, number]> = [];
  for (const [s, e] of all) {
    if (e <= start || s >= end) continue;
    ranges.push([Math.max(s, start) - start, Math.min(e, end) - start]);
  }

  return {
    text:     text.slice(start, end),
    ranges,
    leading:  start > 0,
    trailing: end < text.length,
  };
}