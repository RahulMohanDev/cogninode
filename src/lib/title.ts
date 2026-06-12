// src/lib/title.ts
// Background auto-titling. After the first exchange in a chat completes,
// ask a cheap model for a short topic title to replace the derived
// first-question title. The derived title (StreamsProvider.deriveTitle) is
// set synchronously at send time and stays as the fallback — if this call
// fails or the user renames mid-flight, nothing is lost.

import { db }               from "./db";
import { resolveModelSync } from "./models";
import type { CustomModel } from "./cost";

/** Legacy slug — resolves through LEGACY_MODEL_IDS to the current cheap
 *  flash-lite model, with FALLBACK_MODELS covering an empty catalog, so it
 *  can never come back undefined. */
const TITLE_MODEL_ID = "flash";

/** Same display cap as deriveTitle. */
const TITLE_MAX = 60;
const QUESTION_CLIP = 600;
const ANSWER_CLIP   = 500;

/** Derive a chat/root-node/branch title from the user's first message.
 *  Truncates at the first user-typed fenced code block (or pasted <document>
 *  block) so the title reflects the question, not pasted content. Attached-file
 *  content never reaches composerText — buildPathMessages injects it at prompt
 *  time. Lives here (not in StreamsProvider) so the backfill can recompute the
 *  exact derived label a node would have held, to decide if it's still safe to
 *  retitle. */
export function deriveTitle(text: string): string {
  const firstBlock = text.split(/\n\n(?:<document|```)/)[0] ?? text;
  const cleaned    = firstBlock.replace(/\s+/g, " ").trim();
  return cleaned.length > 60 ? cleaned.slice(0, 60).trimEnd() + "…" : cleaned;
}

/** Clean an LLM-produced title down to a display-ready single line: first
 *  line only, wrapping quotes/backticks and markdown emphasis stripped,
 *  "Title:" prefix dropped, trailing punctuation removed, length-capped.
 *  Returns "" when nothing usable remains. */
export function sanitizeTitle(raw: string): string {
  let t = (raw.split("\n").find(l => l.trim()) ?? "").trim();
  t = t.replace(/^title\s*:\s*/i, "");
  t = t.replace(/^["'`“”‘’*_\s]+/, "").replace(/["'`“”‘’*_\s]+$/, "");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/[.,;:!…]+$/, "").trim();
  if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX).trimEnd() + "…";
  return t;
}

export function buildTitlePrompt(question: string, answer: string): string {
  const q = question.replace(/\s+/g, " ").trim().slice(0, QUESTION_CLIP);
  const a = answer.replace(/\s+/g, " ").trim().slice(0, ANSWER_CLIP);
  return (
    "Write a title of 3-6 words naming the topic of this conversation. " +
    "Reply with the title only — no quotes, no trailing punctuation.\n\n" +
    `Question:\n${q}\n\nStart of the answer:\n${a}`
  );
}

interface GenerateParams {
  apiKey:        string;
  question:      string;
  answer:        string;
  customModels?: CustomModel[];
}

/** One cheap non-streaming completion → sanitized title, or null on any
 *  failure. Never throws — callers fire-and-forget. */
export async function generateChatTitle(params: GenerateParams): Promise<string | null> {
  if (!params.apiKey) return null;
  const model = resolveModelSync(TITLE_MODEL_ID, params.customModels ?? []);
  if (!model) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${params.apiKey}`,
        "HTTP-Referer":  globalThis.location?.origin ?? "https://github.com/RahulMohanDev/cogninode",
        "X-Title":       "cogninode",
      },
      body: JSON.stringify({
        model:      model.openRouterId,
        messages:   [{ role: "user", content: buildTitlePrompt(params.question, params.answer) }],
        max_tokens: 64,
      }),
    });
    if (!response.ok) return null;
    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const title = sanitizeTitle(content);
    return title || null;
  } catch {
    return null;
  }
}

interface AutoTitleParams extends GenerateParams {
  chatId: string;
  /** The title the chat held when this run was armed (derived first-question
   *  title, or the "New chat" placeholder). The swap only commits while the
   *  chat still holds it — a user rename mid-flight always wins. */
  expectedTitle: string;
}

/** Generate and apply an auto-title with compare-and-swap semantics.
 *  Never throws — fire-and-forget; a failure just keeps the derived title. */
export async function autoTitleChat(params: AutoTitleParams): Promise<void> {
  const title = await generateChatTitle(params);
  if (!title || title === params.expectedTitle) return;
  try {
    await db.transaction("rw", db.chats, db.nodes, async () => {
      const chat = await db.chats.get(params.chatId);
      if (!chat || chat.graphId) return;
      if (chat.title !== params.expectedTitle || chat.titleSource === "manual") return;
      await db.chats.update(params.chatId, { title, titleSource: "auto" });
      await db.nodes.update(chat.rootNodeId, { label: title });
    });
  } catch (err) {
    console.warn("[title] auto-title swap failed:", err);
  }
}

interface AutoTitleNodeParams extends GenerateParams {
  nodeId: string;
  /** The label the branch node held when this run was armed (the derived
   *  first-question label). The swap only commits while the node still holds
   *  it — a user rename mid-flight always wins. Only the label is touched, so
   *  the node's createdAt (and thus its sidebar position) never moves. */
  expectedLabel: string;
}

/** Same short-topic compression the root chat gets, applied to a non-root
 *  branch node's label with compare-and-swap. Never throws — fire-and-forget;
 *  a failure just keeps the derived label. */
export async function autoTitleNode(params: AutoTitleNodeParams): Promise<void> {
  const title = await generateChatTitle(params);
  if (!title || title === params.expectedLabel) return;
  try {
    await db.transaction("rw", db.nodes, async () => {
      const node = await db.nodes.get(params.nodeId);
      // A user rename mid-flight moves the label off the derived value — leave
      // it alone. Updating only `label` preserves creation order in the tree.
      if (!node || node.label !== params.expectedLabel) return;
      await db.nodes.update(params.nodeId, { label: title });
    });
  } catch (err) {
    console.warn("[title] auto-title node swap failed:", err);
  }
}

interface BackfillParams {
  apiKey:        string;
  customModels?: CustomModel[];
}

/** One-shot sweep that gives the LLM compression to every chat and branch that
 *  never received it — chats stuck on a "derived" title (the auto-title call
 *  failed at send time, e.g. no key yet / offline) and branch nodes still
 *  holding their first-question label. Reuses the same compare-and-swap entry
 *  points, so it is safe and idempotent: a manually renamed chat/branch, or one
 *  already LLM-titled, no longer matches and is skipped. Sequential to keep the
 *  title model's request rate gentle. Never throws — fire-and-forget. */
export async function backfillTitles(params: BackfillParams): Promise<void> {
  if (!params.apiKey) return;

  const firstExchange = async (nodeId: string) => {
    const msgs = await db.messages.where("nodeId").equals(nodeId).sortBy("createdAt");
    const question = msgs.find(m => m.role === "user")?.content;
    const answer   = msgs.find(m => m.role === "assistant")?.content;
    // Need a completed turn — a question with at least one reply — for context.
    return question && answer ? { question, answer } : null;
  };

  try {
    // Chats: only those still on a "derived" title. "auto" is already done;
    // "manual" and undefined (starter-chip / legacy) are user-owned.
    const chats = await db.chats.toArray();
    for (const chat of chats) {
      if (chat.graphId || chat.titleSource !== "derived") continue;
      const turn = await firstExchange(chat.rootNodeId);
      if (!turn) continue;
      await autoTitleChat({
        chatId:        chat._id,
        expectedTitle: chat.title,
        ...turn,
        apiKey:        params.apiKey,
        customModels:  params.customModels ?? [],
      });
    }

    // Branch nodes: only those whose label still equals the title we'd derive
    // from their first question — i.e. untouched since creation. A manual
    // rename or an earlier LLM swap moves the label off that value, so this
    // never clobbers either.
    const nodes = await db.nodes.toArray();
    for (const node of nodes) {
      if (node.parentId === null) continue;             // root → handled via its chat
      const chat = await db.chats.get(node.chatId);
      if (!chat || chat.graphId) continue;
      const turn = await firstExchange(node._id);
      if (!turn) continue;
      if (node.label !== deriveTitle(turn.question)) continue;
      await autoTitleNode({
        nodeId:        node._id,
        expectedLabel: node.label,
        ...turn,
        apiKey:        params.apiKey,
        customModels:  params.customModels ?? [],
      });
    }
  } catch (err) {
    console.warn("[title] backfill failed:", err);
  }
}
