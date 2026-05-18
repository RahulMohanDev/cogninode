// src/hooks/useStream.ts
import { useState, useCallback, useRef } from "react";
import { streamMessage }                  from "../lib/stream";
import { buildPathMessages, db }          from "../lib/db";
import { getModel }                       from "../lib/cost";
import { useSettings }                    from "./useSettings";

type StreamState = "idle" | "streaming" | "error";

export function useStream(chatId: string, nodeId: string) {
  const [state,         setState]         = useState<StreamState>("idle");
  const [streamingText, setStreamingText] = useState("");
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
    if (!model) return;

    setState("streaming");
    setStreamingText("");
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

      onError: async (msg) => {
        // Remove the user message we persisted if the stream failed
        await db.messages.delete(userMsgId);
        setState("error");
        setStreamingText("");
        console.error("Stream error:", msg);
      },
    });
  }, [state, chatId, nodeId, apiKey, prefs.customModels]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState("idle");
    setStreamingText("");
  }, []);

  return { state, streamingText, send, cancel };
}
