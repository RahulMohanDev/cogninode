// src/lib/docrag/prompt.ts
// Assembles the "Attached document excerpts" block that rides in system
// context when the path contains stubbed (too-large-to-inline) files.
// Pure + budgeted, mirroring graphrag/prompt.ts: chars/4 ≈ tokens, greedy
// fill, a document header never ships without its first excerpt. A
// zero-hit retrieval still produces an explicit block — silence would read
// as "the documents say nothing".

import type { FileExcerpt, FileRetrievalResult } from "./retrieve";

export const FILE_CONTEXT_BUDGET_TOKENS = 4000;
const CHARS_PER_TOKEN = 4;
const INSTRUCTION_ALLOWANCE = 500;   // keep room for the instructions tail

export interface FileContextResult {
  text:            string;
  tokensEstimated: number;
}

const estimateTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

export function buildFileContext(
  retrieval: FileRetrievalResult,
  budgetTokens = FILE_CONTEXT_BUDGET_TOKENS,
): FileContextResult {
  if (retrieval.files.length === 0) return { text: "", tokensEstimated: 0 };

  const budgetChars = budgetTokens * CHARS_PER_TOKEN;
  const metaByFile = new Map(retrieval.files.map(f => [f.fileId, f]));

  let text =
    "# Attached document excerpts\n" +
    "Documents attached in this conversation were too large to include in " +
    "full. ";

  if (retrieval.excerpts.length === 0) {
    const MAX_LISTED = 12;
    text += "\n\nAttached documents:\n";
    for (const f of retrieval.files.slice(0, MAX_LISTED)) {
      text += `- ${f.name} (${f.chars} chars, ${f.chunkCount} parts)\n`;
    }
    if (retrieval.files.length > MAX_LISTED) {
      text += `(… ${retrieval.files.length - MAX_LISTED} more)\n`;
    }
    text +=
      "\nNo passages in these documents matched the current question. If " +
      "the question is about their contents, say that nothing relevant was " +
      "found and suggest the user name or quote the section they mean.";
    return { text, tokensEstimated: estimateTokens(text.length) };
  }

  text += retrieval.matchedQuery
    ? "The passages below are the ones most relevant to the user's " +
      "current question."
    : "No passage matched the current question directly, so the opening " +
      "of each document is shown for orientation — be upfront when that " +
      "isn't enough to answer.";

  // Group per file in rank order of first appearance. Within a group,
  // excerpts stay in RANK order — never re-sort into document order here:
  // the greedy budget below cuts from the tail, and a document-order tail
  // can be the single most relevant excerpt (the [part k/N] labels keep
  // document orientation regardless).
  const groups: Array<{ fileId: string; excerpts: FileExcerpt[] }> = [];
  const groupByFile = new Map<string, { fileId: string; excerpts: FileExcerpt[] }>();
  for (const e of retrieval.excerpts) {
    let g = groupByFile.get(e.fileId);
    if (!g) {
      g = { fileId: e.fileId, excerpts: [] };
      groupByFile.set(e.fileId, g);
      groups.push(g);
    }
    g.excerpts.push(e);
  }

  let used = text.length;
  for (const g of groups) {
    const meta = metaByFile.get(g.fileId);
    const name = g.excerpts[0]?.fileName ?? meta?.name ?? "?";
    const header = meta
      ? `\n\n## ${name} (${meta.chars} chars, ${meta.chunkCount} parts)\n`
      : `\n\n## ${name}\n`;
    const partOf = (e: FileExcerpt): string =>
      `[part ${e.chunkIndex + 1}${meta ? `/${meta.chunkCount}` : ""}]\n${e.text}\n`;

    const first = g.excerpts[0] ? partOf(g.excerpts[0]) : "";
    // Never ship a header the budget can't follow with content.
    if (used + header.length + first.length + INSTRUCTION_ALLOWANCE > budgetChars) break;
    text += header + first;
    used += header.length + first.length;
    for (const e of g.excerpts.slice(1)) {
      const t = partOf(e);
      if (used + t.length + INSTRUCTION_ALLOWANCE > budgetChars) break;
      text += t;
      used += t.length;
    }
  }

  text +=
    "\n\n# Instructions\n" +
    "Treat the excerpts above as the contents of the user's attached " +
    "documents. When you draw on one, mention the document by name. If the " +
    "excerpts don't cover what's asked, say so plainly — never guess at " +
    "parts of a document that aren't quoted here.";

  return { text, tokensEstimated: estimateTokens(text.length) };
}
