// scripts/docrag-smoke.mjs
// End-to-end smoke for file RAG: attach a >60k-char text file with a
// buried sentinel, send a question about it, and assert on the CAPTURED
// OpenRouter request body that (a) the user message carries the indexed
// stub, not the full document, and (b) the system message carries the
// "Attached document excerpts" block including the sentinel's chunk.
// Run from the repo root with the dev server up:  node scripts/docrag-smoke.mjs

import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const SENTINEL = "zanzibar-protocol checksum 7741";

// ~70k chars of position-unique filler with the sentinel buried mid-file.
const para = (i) =>
  `Paragraph ${i}: ordinary operational filler text about deployment pipelines, retries, and configuration drift, item ${i}.`;
const parts = [];
for (let i = 0; i < 600; i++) {
  parts.push(i === 300 ? `Paragraph ${i}: the ${SENTINEL} must be verified before rollout.` : para(i));
}
const BIG_DOC = parts.join("\n\n");
if (BIG_DOC.length <= 60_000) throw new Error("fixture too small");

const SSE_BODY = [
  'data: {"choices":[{"delta":{"content":"Acknowledged."},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}',
  "data: [DONE]",
  "",
].join("\n\n");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  // Force local (BYOK) mode regardless of Clerk/Convex env — see
  // lib/managedConfig.ts.
  localStorage.setItem("cogninode_force_local", "1");
  localStorage.setItem("cogninode_api_key", "sk-or-dummy-key-for-ui-testing");
});
const page = await ctx.newPage();
page.on("console", (msg) => {
  if (msg.type() === "warning" || msg.type() === "error") console.log(`[browser ${msg.type()}]`, msg.text());
});
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

const captured = [];
await page.route("**/api/v1/chat/completions", async (route) => {
  captured.push(route.request().postDataJSON());
  await route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: SSE_BODY,
  });
});

await page.goto(APP, { waitUntil: "networkidle" });

// Seed a chat so the composer is mounted at /chat/c1.
await page.evaluate(async () => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open("cogninode");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const db = await open();
  const now = Date.now();
  const put = (store, val) => new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(val);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  await put("chats", { _id: "c1", title: "doc test", rootNodeId: "c1root", currentNodeId: "c1root", createdAt: now, updatedAt: now });
  await put("nodes", { _id: "c1root", chatId: "c1", parentId: null, depth: 0, label: "doc test", createdAt: now });
});
await page.goto(`${APP}/chat/c1`, { waitUntil: "networkidle" });

// Attach the big file through the real upload path (storeFile + hooks).
await page.setInputFiles('input[type="file"]', {
  name: "ops-runbook.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(BIG_DOC, "utf8"),
});
await page.waitForSelector("text=ops-runbook.txt", { timeout: 10_000 });

// The chip must carry the "indexed" badge (contentChars > INLINE_MAX_CHARS).
const badge = await page.locator("text=indexed").count();
if (badge === 0) throw new Error("FAIL: 'indexed' badge missing on large-file chip");
console.log("PASS: indexed badge shown on attachment chip");

// Give the 120ms hook-flush a moment so chunks are keyword-searchable.
await page.waitForTimeout(600);

const ask = async (text) => {
  const before = captured.length;
  await page.fill("textarea", text);
  await page.click('button[title="Send (Cmd/Ctrl+Enter)"]');
  // Wait until the request lands.
  for (let i = 0; i < 100 && captured.length === before; i++) await page.waitForTimeout(100);
  if (captured.length === before) throw new Error("FAIL: no OpenRouter request captured");
  return captured[captured.length - 1];
};

// ── Send 1: question targeting the buried sentinel ────────────────────
const body1 = await ask("What does the runbook say about the zanzibar protocol checksum?");

const sys1 = body1.messages[0];
if (sys1.role !== "system") throw new Error("FAIL: first message is not the system prompt");
const userMsgs1 = body1.messages.filter((m) => m.role === "user");
const lastUser1 = userMsgs1[userMsgs1.length - 1];
const userText1 = typeof lastUser1.content === "string" ? lastUser1.content : JSON.stringify(lastUser1.content);

if (!userText1.includes('indexed="true"')) throw new Error("FAIL: stub missing from user message");
if (userText1.includes(SENTINEL)) throw new Error("FAIL: full document leaked into the user message");
console.log("PASS: attach turn sends stub, not the 70k document");

if (!sys1.content.includes("Attached document excerpts")) throw new Error("FAIL: excerpts block missing from system message");
if (!sys1.content.includes(SENTINEL)) {
  const partsSeen = [...sys1.content.matchAll(/\[part (\d+)\/\d+\]/g)].map((m) => m[1]);
  console.error("parts retrieved:", partsSeen.join(", "));
  throw new Error("FAIL: sentinel chunk not retrieved into system context");
}
console.log("PASS: system context carries retrieved excerpts incl. the sentinel chunk");

// ── Send 2: history must stay stubbed ─────────────────────────────────
await page.waitForTimeout(400);
const body2 = await ask("Anything else important in there?");
const allUser2 = body2.messages.filter((m) => m.role === "user")
  .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n===\n");
if (!allUser2.includes('indexed="true"')) throw new Error("FAIL: historical stub vanished on turn 2");
if (allUser2.includes(SENTINEL)) throw new Error("FAIL: full document re-inlined on turn 2");
if (!body2.messages[0].content.includes("Attached document excerpts")) throw new Error("FAIL: excerpts block missing on turn 2");
console.log("PASS: turn 2 keeps the stub and the excerpts block");

const reqSize1 = JSON.stringify(body1).length;
if (reqSize1 > BIG_DOC.length) throw new Error(`FAIL: request (${reqSize1}) not smaller than the document (${BIG_DOC.length})`);
console.log(`PASS: request body ${reqSize1} chars vs ${BIG_DOC.length}-char document`);

await browser.close();
console.log("docrag smoke: ALL PASS");
