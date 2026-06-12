// src/lib/pathMessages.test.ts
// buildPathMessages threshold matrix (real Dexie via fake-indexeddb):
// small files always inline, large files inline only on the attach turn
// (and only under the cap), everything else collapses to an indexed stub
// whose fileId is reported for retrieval.

import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll } from "vitest";
import { db, buildPathMessages, type StoredFile } from "./db";
import { INLINE_MAX_CHARS, ATTACH_TURN_CAP_CHARS } from "./docrag/chunk";

const CHAT = "chat-1";
const ROOT = "node-root";

/** Position-unique text so a deep slice can never match the head preview. */
const uniqueDoc = (label: string, paragraphs: number): string =>
  Array.from({ length: paragraphs }, (_, i) =>
    `Paragraph ${i} of ${label}: distinct content marker ${label}-${i} with enough filler to give each paragraph realistic length.`,
  ).join("\n\n");

const SMALL_TEXT  = uniqueDoc("small", 8);     // ~1k
const MEDIUM_TEXT = uniqueDoc("medium", 160);  // ~20k
const HUGE_TEXT   = uniqueDoc("huge", 560);    // ~70k

const file = (id: string, name: string, kind: StoredFile["kind"], content: string): StoredFile => ({
  _id: id, name, kind, mimeType: "text/plain", sizeBytes: content.length, content, createdAt: 1,
});

let msgSeq = 0;
async function addUserMsg(nodeId: string, content: string, fileIds: string[] = [], quote?: string) {
  const _id = `m-${++msgSeq}`;
  await db.messages.add({
    _id, nodeId, chatId: CHAT, role: "user", content,
    fileIds, ...(quote ? { quote } : {}), createdAt: msgSeq,
  });
  return _id;
}
async function addAssistantMsg(nodeId: string, content: string) {
  await db.messages.add({
    _id: `m-${++msgSeq}`, nodeId, chatId: CHAT, role: "assistant", content, createdAt: msgSeq,
  });
}

beforeAll(async () => {
  expect(MEDIUM_TEXT.length).toBeGreaterThan(INLINE_MAX_CHARS);
  expect(MEDIUM_TEXT.length).toBeLessThan(ATTACH_TURN_CAP_CHARS);
  expect(HUGE_TEXT.length).toBeGreaterThan(ATTACH_TURN_CAP_CHARS);

  await db.nodes.add({ _id: ROOT, chatId: CHAT, parentId: null, depth: 0, label: "root", createdAt: 1 });
  await db.files.bulkAdd([
    file("f-small",  "notes.txt",  "file", SMALL_TEXT),
    file("f-medium", "spec.pdf",   "pdf",  MEDIUM_TEXT),
    file("f-huge",   "corpus.pdf", "pdf",  HUGE_TEXT),
    file("f-img",    "shot.png",   "image", "data:image/png;base64,AAAA"),
  ]);
});

const lastText = (r: Awaited<ReturnType<typeof buildPathMessages>>): string => {
  const content = r.messages[r.messages.length - 1]!.content;
  return typeof content === "string" ? content : JSON.stringify(content);
};

describe("buildPathMessages thresholds", () => {
  it("small files inline in full on every turn", async () => {
    await addUserMsg(ROOT, "what does the note say?", ["f-small"]);
    let r = await buildPathMessages(CHAT, ROOT);
    expect(lastText(r)).toContain(SMALL_TEXT.slice(0, 100));
    expect(r.stubbedFileIds).toEqual([]);

    await addAssistantMsg(ROOT, "it says things");
    await addUserMsg(ROOT, "follow-up");
    r = await buildPathMessages(CHAT, ROOT);
    // Historical small file still fully inlined.
    expect(r.messages.map(m => m.content).join("\n")).toContain(SMALL_TEXT.slice(0, 100));
    expect(r.stubbedFileIds).toEqual([]);
  });

  it("medium files: full on the attach turn, stub afterwards", async () => {
    const mid = await addUserMsg(ROOT, "summarize the spec", ["f-medium"]);
    let r = await buildPathMessages(CHAT, ROOT);
    // Attach turn (last user message) → full content, no stub.
    expect(lastText(r)).toContain(MEDIUM_TEXT.slice(0, 120));
    expect(lastText(r)).not.toContain('indexed="true"');
    expect(r.stubbedFileIds).toEqual([]);

    await addAssistantMsg(ROOT, "summary…");
    await addUserMsg(ROOT, "and section 3?");
    r = await buildPathMessages(CHAT, ROOT);
    const all = r.messages
      .map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n===\n");
    // Historical turn now stubs: head preview present, full body absent.
    expect(all).toContain('<document name="spec.pdf" kind="pdf"');
    expect(all).toContain('indexed="true"');
    expect(all).toContain("[beginning of document]");
    expect(all).toContain(MEDIUM_TEXT.slice(0, 80));            // head preview
    expect(all).not.toContain(MEDIUM_TEXT.slice(2000, 2120));   // deep body gone
    expect(r.stubbedFileIds).toEqual(["f-medium"]);
    void mid;
  });

  it("huge files stub even on the attach turn", async () => {
    await addAssistantMsg(ROOT, "ok");
    await addUserMsg(ROOT, "digest this corpus", ["f-huge"]);
    const r = await buildPathMessages(CHAT, ROOT);
    const last = lastText(r);
    expect(last).toContain('<document name="corpus.pdf"');
    expect(last).toContain('indexed="true"');
    expect(last).not.toContain(HUGE_TEXT.slice(5000, 5120));
    expect(r.stubbedFileIds).toContain("f-huge");
    // The earlier medium file is still a historical stub too — dedup holds.
    expect(r.stubbedFileIds).toEqual(["f-medium", "f-huge"]);
  });

  it("dedupes a file attached on multiple path messages", async () => {
    await addAssistantMsg(ROOT, "done");
    await addUserMsg(ROOT, "check the spec again", ["f-medium"]);
    await addAssistantMsg(ROOT, "checked");
    await addUserMsg(ROOT, "one more question");
    const r = await buildPathMessages(CHAT, ROOT);
    expect(r.stubbedFileIds.filter(id => id === "f-medium")).toHaveLength(1);
  });

  it("shares the attach-turn budget across the turn's large files", async () => {
    const A = uniqueDoc("budgetA", 320);   // ~41k each — two together exceed 60k
    const B = uniqueDoc("budgetB", 320);
    expect(A.length + B.length).toBeGreaterThan(ATTACH_TURN_CAP_CHARS);
    await db.nodes.add({ _id: "node-b", chatId: "chat-b", parentId: null, depth: 0, label: "b", createdAt: 1 });
    await db.files.bulkAdd([file("f-bud-a", "a.pdf", "pdf", A), file("f-bud-b", "b.pdf", "pdf", B)]);
    await db.messages.add({
      _id: "mb-1", nodeId: "node-b", chatId: "chat-b", role: "user",
      content: "compare these", fileIds: ["f-bud-a", "f-bud-b"], createdAt: 1,
    });
    const r = await buildPathMessages("chat-b", "node-b");
    const last = lastText(r);
    // First file fits the budget and inlines; the second would blow the
    // turn total, so it stubs and gets excerpts instead.
    expect(last).toContain(A.slice(20_000, 20_100));
    expect(last).not.toContain(B.slice(20_000, 20_100));
    expect(last).toContain('<document name="b.pdf"');
    expect(r.stubbedFileIds).toEqual(["f-bud-b"]);
  });

  it("re-attaching a file on the attach turn inlines it once, with no excerpts", async () => {
    const RE = uniqueDoc("reattach", 160); // ~20k — medium
    await db.nodes.add({ _id: "node-c", chatId: "chat-c", parentId: null, depth: 0, label: "c", createdAt: 1 });
    await db.files.add(file("f-re", "re.pdf", "pdf", RE));
    await db.messages.bulkAdd([
      { _id: "mc-1", nodeId: "node-c", chatId: "chat-c", role: "user",
        content: "first look", fileIds: ["f-re"], createdAt: 1 },
      { _id: "mc-2", nodeId: "node-c", chatId: "chat-c", role: "assistant",
        content: "looked", createdAt: 2 },
      { _id: "mc-3", nodeId: "node-c", chatId: "chat-c", role: "user",
        content: "look again", fileIds: ["f-re"], createdAt: 3 },
    ]);
    const r = await buildPathMessages("chat-c", "node-c");
    // Historical occurrence stubs, attach turn inlines in full…
    const all = r.messages.map(m => m.content).join("\n===\n");
    expect(all).toContain('indexed="true"');
    expect(lastText(r)).toContain(RE.slice(10_000, 10_100));
    // …and the model already has the document, so no excerpts are needed.
    expect(r.stubbedFileIds).toEqual([]);
  });

  it("keeps quote + typed-text composition and image parts unchanged", async () => {
    await addUserMsg(ROOT, "about this image", ["f-img"], "quoted excerpt");
    const r = await buildPathMessages(CHAT, ROOT);
    const last = r.messages[r.messages.length - 1]!;
    expect(Array.isArray(last.content)).toBe(true);
    const parts = last.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0]!.type).toBe("text");
    expect(parts[0]!.text).toContain("quoted excerpt");
    expect(parts[0]!.text).toContain("about this image");
    expect(parts[1]!.type).toBe("image_url");
    expect(parts[1]!.image_url!.url).toContain("data:image/png");
    expect(r.stubbedFileIds).not.toContain("f-img");
  });
});
