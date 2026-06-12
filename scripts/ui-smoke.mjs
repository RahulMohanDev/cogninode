import { chromium } from "playwright";
const APP = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  // Force local (BYOK) mode even if the dev server has Clerk/Convex env
  // configured — keeps the smoke deterministic. See lib/managedConfig.ts.
  localStorage.setItem("cogninode_force_local", "1");
  localStorage.setItem("cogninode_api_key", "sk-or-dummy-key-for-ui-testing");
  localStorage.setItem("cogninode_theme", "dark");
});
const page = await ctx.newPage();
await page.goto(APP, { waitUntil: "networkidle" });
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
  await put("chats", { _id: "c1", title: "Java learning", rootNodeId: "c1root", currentNodeId: "c1n1", createdAt: now - 86400000, updatedAt: now });
  await put("nodes", { _id: "c1root", chatId: "c1", parentId: null, depth: 0, label: "Java learning", createdAt: now - 86400000 });
  await put("nodes", { _id: "c1n1", chatId: "c1", parentId: "c1root", depth: 1, label: "generics deep dive", createdAt: now - 80000000 });
  await put("messages", { _id: "m1", nodeId: "c1root", chatId: "c1", role: "user", content: "I want to learn Java properly, where should I start?", createdAt: now - 86400000 });
  await put("messages", { _id: "m3", nodeId: "c1n1", chatId: "c1", role: "user", content: "How do Java generics work with wildcard bounds?", createdAt: now - 80000000 });
  await put("messages", { _id: "m4", nodeId: "c1n1", chatId: "c1", role: "assistant", content: "Type erasure removes generic type info at runtime. PECS: producer-extends, consumer-super.", createdAt: now - 79000000 });
  await put("chats", { _id: "c2", title: "Indonesia trip", rootNodeId: "c2root", currentNodeId: "c2root", createdAt: now - 50000000, updatedAt: now - 100000 });
  await put("nodes", { _id: "c2root", chatId: "c2", parentId: null, depth: 0, label: "Indonesia trip", createdAt: now - 50000000 });
  await put("messages", { _id: "m5", nodeId: "c2root", chatId: "c2", role: "user", content: "Best coffee plantations to visit on Java island?", createdAt: now - 50000000 });
});
await page.reload({ waitUntil: "networkidle" });

// Wait for the semantic pipeline: download (proxied) → wasm → indexing → hybrid.
try {
  await page.waitForSelector('text=hybrid', { timeout: 150000 });
  console.log("SEMANTIC: reached hybrid ✓");
} catch {
  const fail = page.locator('button:has-text("semantic search failed")');
  console.log("SEMANTIC: did not reach hybrid.",
    (await fail.count()) ? "Error: " + await fail.getAttribute("title") : "(no failure strip — still busy?)");
}
await page.screenshot({ path: "/tmp/e2e-1-footer.png", clip: { x: 0, y: 540, width: 300, height: 360 } });

await page.fill('input[placeholder="Search chats…"]', "java");
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/e2e-2-search.png", clip: { x: 0, y: 0, width: 300, height: 620 } });
await browser.close();
console.log("done");
