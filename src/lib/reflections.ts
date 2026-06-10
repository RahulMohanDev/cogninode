// src/lib/reflections.ts
// Build and persist "reflection" snapshots: the messages along root →
// currentNodeId distilled into one markdown document. The pure composition
// helpers are separated from the Dexie-touching ones so they can be
// unit-tested without a database.

import { db, newId, type Message } from "./db";
import { findPath }                from "./path";

/** Drafts above this size get a warning in the save dialog. */
export const REFLECTION_SIZE_WARN_BYTES = 100 * 1024;

export interface ReflectionSourceMessage {
  role:       "user" | "assistant";
  content:    string;
  reasoning?: string;
}

/**
 * Concatenate path messages into the reflection body. When
 * `includeReasoning` is set, an assistant message's chain-of-thought is
 * rendered as a labelled blockquote above its answer (previously the
 * reasoning field was silently dropped).
 */
export function composeReflectionBody(
  messages: ReflectionSourceMessage[],
  opts: { includeReasoning: boolean },
): string {
  const sections: string[] = [];
  for (const m of messages) {
    const speaker = m.role === "user" ? "**You**" : "**Assistant**";
    const parts: string[] = [speaker];
    if (opts.includeReasoning && m.role === "assistant" && m.reasoning?.trim()) {
      const quoted = m.reasoning.trim().split("\n").map(l => `> ${l}`).join("\n");
      parts.push(`> _Reasoning_\n>\n${quoted}`);
    }
    parts.push(m.content);
    sections.push(parts.join("\n\n"));
  }
  return sections.join("\n\n---\n\n");
}

export function deriveReflectionTitle(
  nodeLabel: string | undefined,
  chatTitle: string,
): string {
  const raw = nodeLabel?.trim() || chatTitle.trim() || "Reflection";
  return raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
}

export interface ReflectionDraft {
  title:        string;
  body:         string;
  messageCount: number;
  sizeBytes:    number;
  /** Whether any assistant message on the path carries a reasoning trace. */
  hasReasoning: boolean;
}

/** Collect the root → nodeId path and compose a draft. Saves nothing. */
export async function buildReflectionDraft(
  chatId: string,
  nodeId: string,
  opts: { includeReasoning: boolean },
): Promise<ReflectionDraft | null> {
  const chat = await db.chats.get(chatId);
  if (!chat) return null;
  const allNodes = await db.nodes.where("chatId").equals(chatId).toArray();
  const ids = findPath(allNodes, nodeId);
  if (ids.length === 0) return null;
  const currentNode = allNodes.find(n => n._id === nodeId);

  const collected: Message[] = [];
  for (const nid of ids) {
    const msgs = await db.messages.where("nodeId").equals(nid).sortBy("createdAt");
    collected.push(...msgs);
  }

  const body = composeReflectionBody(collected, opts);
  return {
    title:        deriveReflectionTitle(currentNode?.label, chat.title),
    body,
    messageCount: collected.length,
    sizeBytes:    new TextEncoder().encode(body).length,
    hasReasoning: collected.some(m => m.role === "assistant" && !!m.reasoning?.trim()),
  };
}

export async function saveReflection(params: {
  chatId: string;
  nodeId: string;
  title:  string;
  body:   string;
}): Promise<string> {
  const _id = newId();
  await db.reflections.put({
    _id,
    chatId:    params.chatId,
    nodeId:    params.nodeId,
    title:     params.title.trim() || "Reflection",
    body:      params.body,
    updatedAt: Date.now(),
  });
  return _id;
}
