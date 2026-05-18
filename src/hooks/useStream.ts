// src/hooks/useStream.ts
import { useState, useCallback, useRef } from "react";
import { streamMessage }                  from "../lib/stream";
import { buildPathMessages, db }          from "../lib/db";
import { getModel }                       from "../lib/cost";
import { useSettings }                    from "./useSettings";

type StreamState = "idle" | "streaming" | "error";

// Derive a chat/root-node title from the user's first message. Drops any
// auto-appended file blocks (PDF excerpts or code fences added by storeFile)
// so the title reflects what the user typed, not what they attached.
function deriveTitle(text: string): string {
  const firstBlock = text.split(/\n\n(?:<document|```)/)[0] ?? text;
  const cleaned    = firstBlock.replace(/\s+/g, " ").trim();
  return cleaned.length > 60 ? cleaned.slice(0, 60).trimEnd() + "…" : cleaned;
}

export function useStream(chatId: string, nodeId: string) {
  const [state,         setState]         = useState<StreamState>("idle");
  const [streamingText, setStreamingText] = useState("");
  const [error,         setError]         = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { apiKey, prefs } = useSettings();

  const send = useCallback(async (params: {
    modelId:      string;
    composerText: string;
    quote?:       string;
    fileIds?:     string[];
  }) => {
    if (state === "streaming") return;

    const model = getModel(params.modelId, prefs.customModels);
    if (!model) {
      setError(`Unknown model id: ${params.modelId}`);
      setState("error");
      return;
    }

    setState("streaming");
    setStreamingText("");
    setError(null);
    abortRef.current = new AbortController();

    // Persist user message to Dexie first
    const userMsgId = crypto.randomUUID();
    await db.messages.add({
      _id:       userMsgId,
      nodeId,
      chatId,
      role:      "user",
      content:   params.composerText,
      ...(params.quote !== undefined ? { quote: params.quote } : {}),
      fileIds:   params.fileIds ?? [],
      createdAt: Date.now(),
    });

    // Auto-title the chat + root node from the first user message on root.
    // Only fires while the title is still the default placeholder, so any
    // user-chosen title (e.g. from a starter chip) is preserved.
    const chatRecord = await db.chats.get(chatId);
    if (chatRecord && chatRecord.title === "New chat" && nodeId === chatRecord.rootNodeId) {
      const title = deriveTitle(params.composerText);
      if (title) {
        await db.chats.update(chatId, { title, updatedAt: Date.now() });
        await db.nodes.update(chatRecord.rootNodeId, { label: title });
      }
    }

    // Build path context from Dexie
    const pathMessages = await buildPathMessages(chatId, nodeId);
    // Remove the message we just added (it's already the last user msg)
    const contextMessages = pathMessages.slice(0, -1);

    let fullContent = "";

    await streamMessage({
      apiKey,
      openRouterId: model.openRouterId,
      messages: contextMessages,
      model,
      signal: abortRef.current.signal,

      onChunk: (text) => {
        fullContent += text;
        setStreamingText(prev => prev + text);
      },

      onDone: async ({ inputTokens, outputTokens, costUsd }) => {
        // Persist assistant message
        await db.messages.add({
          _id:          crypto.randomUUID(),
          nodeId,
          chatId,
          role:         "assistant",
          content:      fullContent,
          modelId:      params.modelId,
          costUsd,
          inputTokens,
          outputTokens,
          pathDepth:    contextMessages.length,
          createdAt:    Date.now(),
        });

        // Update chat's updatedAt
        await db.chats.update(chatId, { updatedAt: Date.now() });

        setState("idle");
        setStreamingText("");
      },

      onError: async (msg, status) => {
        // Remove the user message we persisted if the stream failed
        await db.messages.delete(userMsgId);
        setState("error");
        setStreamingText("");
        setError(status ? `${msg} (HTTP ${status})` : msg);
        console.error("Stream error:", msg, status);
      },
    });
  }, [state, chatId, nodeId, apiKey, prefs.customModels]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState("idle");
    setStreamingText("");
  }, []);

  return { state, streamingText, error, send, cancel };
}
