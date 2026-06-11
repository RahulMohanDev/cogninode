// src/lib/graphrag/prompt.ts
// Assembles the system-context block the dock chat sends with every
// question: root preamble (the graph's scope), a compact outline of the
// user's curated map, then ranked excerpt groups tagged [S1..Sn] for
// inline citation. Pure + budgeted — chars/4 ≈ tokens, greedy fill, a
// group header never ships without its first block.
//
// Note: the root's ATTACHED content isn't force-included here — root-owned
// docs already carry the strongest proximity boost (dist 0) in
// retrieve.ts, so they win ranking whenever they're relevant. The reserve
// below protects the root's own notes, which are always present.

import type { RagSourceRef } from "../db";
import type { RetrievalResult, RetrievedBlock } from "./retrieve";

export const GRAPH_CONTEXT_BUDGET_TOKENS = 8000;
const CHARS_PER_TOKEN   = 4;
const ROOT_RESERVE      = 0.2;    // ≤20% of budget for the root preamble
const OUTLINE_RESERVE   = 0.1;    // ≤10% for the graph map
const OUTLINE_MAX_NODES = 60;

export interface GraphContextResult {
  text:            string;
  sources:         RagSourceRef[];
  tokensEstimated: number;
}

const estimateTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

export function buildGraphContext(
  retrieval: RetrievalResult,
  budgetTokens = GRAPH_CONTEXT_BUDGET_TOKENS,
): GraphContextResult {
  const corpus = retrieval.corpus;
  if (!corpus) return { text: "", sources: [], tokensEstimated: 0 };

  const budgetChars = budgetTokens * CHARS_PER_TOKEN;
  const root = corpus.nodesById.get(corpus.rootGraphNodeId);
  const rootTitle = root?.label.trim() || "this graph";

  // ── 1 · root preamble — the scope every answer anchors to ─────────
  const rootReserve = Math.floor(budgetChars * ROOT_RESERVE);
  let preamble =
    `You are answering inside "${rootTitle}" — a knowledge graph the user ` +
    `curated by hand from their own chats and notes. Treat the context ` +
    `below as the primary source of truth.\n\n# Root: ${rootTitle}`;
  const rootNotes = root?.notes.trim() ?? "";
  if (rootNotes) {
    preamble += `\n${rootNotes.slice(0, Math.max(0, rootReserve - preamble.length))}`;
  }

  // ── 2 · graph map — the user's curated structure, labels only ─────
  const outlineBudget = Math.floor(budgetChars * OUTLINE_RESERVE);
  const ordered = [...corpus.nodesById.values()].sort((a, b) =>
    (corpus.distFromRoot.get(a._id)! - corpus.distFromRoot.get(b._id)!) ||
    (a.createdAt - b.createdAt));
  const edgeLabel = (childId: string): string => {
    const parent = corpus.parentByNode.get(childId);
    if (!parent) return "";
    const e = corpus.edges.find(x =>
      (x.source === childId && x.target === parent) ||
      (x.source === parent && x.target === childId));
    return e?.label ? ` — ${e.label}` : "";
  };

  let outline = "\n\n# Graph map\n";
  let outlined = 0;
  let sawDisconnected = false;
  const maxFiniteDist = Math.max(0, ...[...corpus.distFromRoot.entries()]
    .filter(([id]) => corpus.parentByNode.get(id) !== null || id === corpus.rootGraphNodeId)
    .map(([, d]) => d));
  for (const n of ordered) {
    if (outlined >= OUTLINE_MAX_NODES) {
      outline += `(… ${ordered.length - outlined} more nodes)\n`;
      break;
    }
    const labels = corpus.pathLabels.get(n._id) ?? [];
    const title = labels[labels.length - 1] ?? "?";
    const dist = corpus.distFromRoot.get(n._id)!;
    const disconnected = n._id !== corpus.rootGraphNodeId && corpus.parentByNode.get(n._id) === null;
    if (disconnected && !sawDisconnected) {
      sawDisconnected = true;
      outline += "(not yet connected to the root:)\n";
    }
    const indent = disconnected ? "" : "  ".repeat(Math.min(dist, maxFiniteDist));
    const row = `${indent}- ${title}${disconnected ? "" : edgeLabel(n._id)}\n`;
    if (outline.length + row.length > outlineBudget) break;
    outline += row;
    outlined++;
  }

  // ── 3 · retrieved excerpts, grouped per graph node, tagged [S#] ───
  const groups: Array<{ graphNodeId: string; blocks: RetrievedBlock[] }> = [];
  const groupByNode = new Map<string, { graphNodeId: string; blocks: RetrievedBlock[] }>();
  for (const b of retrieval.blocks) {
    let g = groupByNode.get(b.graphNodeId);
    if (!g) {
      g = { graphNodeId: b.graphNodeId, blocks: [] };
      groupByNode.set(b.graphNodeId, g);
      groups.push(g);                       // rank order of first appearance
    }
    g.blocks.push(b);
  }

  const blockText = (b: RetrievedBlock): string => {
    if (b.kind === "message")    return `(${b.role ?? "message"}) ${b.text}`;
    if (b.kind === "reflection") return `(reflection: ${b.title}) ${b.text}`;
    return `(node notes${b.title ? `: ${b.title}` : ""}) ${b.text}`;
  };

  const sources: RagSourceRef[] = [];
  let excerpts = "";
  let used = preamble.length + outline.length;
  const instructionAllowance = 600;        // keep room for section 4

  for (const g of groups) {
    const tag = `S${sources.length + 1}`;
    const path = (corpus.pathLabels.get(g.graphNodeId) ?? ["?"]).join(" › ");
    const header = `\n### [${tag}] ${path}\n`;
    const first = g.blocks[0] ? blockText(g.blocks[0]) + "\n" : "";
    // Never ship a header the budget can't follow with content.
    if (used + header.length + first.length + instructionAllowance > budgetChars) break;
    excerpts += header + first;
    used += header.length + first.length;
    for (const b of g.blocks.slice(1)) {
      const t = blockText(b) + "\n";
      if (used + t.length + instructionAllowance > budgetChars) break;
      excerpts += t;
      used += t.length;
    }
    sources.push({ tag, graphNodeId: g.graphNodeId });
  }
  if (excerpts) excerpts = "\n\n# Retrieved context" + excerpts;

  // ── 4 · instructions ───────────────────────────────────────────────
  const instruction = excerpts
    ? "\n\n# Instructions\nAnswer using the retrieved context above. Cite " +
      "source groups inline like [S1] whenever you draw on them. If the " +
      "context is insufficient to answer fully, say so and suggest which " +
      "chats or nodes the user could add to this graph."
    : "\n\n# Instructions\nNothing in this graph matched the question yet. " +
      "Say so plainly, answer from general knowledge only if clearly " +
      "helpful, and suggest which chats, branches, or notes the user " +
      "could attach to this graph so future answers are grounded.";

  const text = preamble + outline + excerpts + instruction;
  return { text, sources, tokensEstimated: estimateTokens(text.length) };
}
