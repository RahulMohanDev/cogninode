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
/** Cap on the stored first question (hover tooltip context). */
export const FIRST_QUESTION_MAX = 280;

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

/** Tooltip for a chat row: the full title, plus the original first question
 *  when it adds context beyond the (possibly auto-generated) title. */
export function chatHoverTitle(chat: { title: string; firstQuestion?: string }): string {
  const title = chat.title || "Untitled";
  const q = chat.firstQuestion?.trim();
  if (q && q !== title) return `${title}\n\n${q}`;
  return title;
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
        "HTTP-Referer":  "https://github.com/RahulMohanDev/cogninode",
        "X-Title":       "cogninode beta",
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
