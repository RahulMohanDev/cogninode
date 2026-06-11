// src/lib/domHighlight.ts
// Term highlighting inside rendered markdown via the CSS Custom Highlight
// API (CSS.highlights + Highlight). Range-based, so it works across the
// element structure streamdown produces without mutating the DOM. Styled
// by the ::highlight(cogninode-search) rule in app.css. No-ops silently
// on browsers without the API — the message flash still shows.

const HIGHLIGHT_NAME = "cogninode-search";

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void;
  delete(name: string): boolean;
}

type HighlightCtor = new (...ranges: Range[]) => unknown;

function registry(): HighlightRegistryLike | null {
  const css = CSS as unknown as { highlights?: HighlightRegistryLike };
  return css.highlights ?? null;
}

function highlightCtor(): HighlightCtor | null {
  const ctor = (globalThis as Record<string, unknown>)["Highlight"];
  return typeof ctor === "function" ? (ctor as HighlightCtor) : null;
}

/** Highlight every occurrence of `terms` (case-insensitive) within `root`.
 *  Replaces any previous search highlight. */
export function highlightTermsInElement(root: HTMLElement, terms: string[]): void {
  const reg = registry();
  const Ctor = highlightCtor();
  if (!reg || !Ctor) return;

  reg.delete(HIGHLIGHT_NAME);

  const needles = [...new Set(terms.map(t => t.toLowerCase()))].filter(t => t.length > 1);
  if (needles.length === 0) return;

  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  outer: while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    if (!text) continue;
    const lower = text.toLowerCase();
    if (lower.length !== text.length) continue; // U+0130 İ lowercases to 2 code units; offsets into `lower` would misalign with the node
    for (const needle of needles) {
      let from = 0;
      while (true) {
        const at = lower.indexOf(needle, from);
        if (at === -1) break;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        ranges.push(range);
        from = at + needle.length;
        if (ranges.length >= 200) break outer;   // pathological inputs
      }
    }
  }

  if (ranges.length === 0) return;
  reg.set(HIGHLIGHT_NAME, new Ctor(...ranges));
}

export function clearSearchHighlight(): void {
  registry()?.delete(HIGHLIGHT_NAME);
}