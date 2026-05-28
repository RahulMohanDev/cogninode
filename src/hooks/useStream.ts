// src/hooks/useStream.ts
// Thin selector over StreamsProvider. The public API is preserved so
// ChatApp / Stream / Composer keep compiling without any wiring changes:
//
//   const { state, streamingText, streamingReasoning, error, send, cancel }
//     = useStream(chatId, currentNodeId);
//
// All real work — abort controllers, Dexie writes, eventsource-parser —
// lives in StreamsProvider. This module just reads the slot for the
// passed-in nodeId.

import { useCallback } from "react";
import {
  useStreamsContext, useStreamSlot, type SendParams,
} from "./StreamsProvider";

type StreamState = "idle" | "streaming" | "error";

export function useStream(chatId: string, nodeId: string) {
  const ctx  = useStreamsContext();
  const slot = useStreamSlot(nodeId);

  const state: StreamState = slot?.state ?? "idle";
  const streamingText      = slot?.streamingText      ?? "";
  const streamingReasoning = slot?.streamingReasoning ?? "";
  const error              = slot?.error              ?? null;
  const errorStatus        = slot?.errorStatus;

  const send = useCallback((params: SendParams) => {
    ctx.send(chatId, nodeId, params);
  }, [ctx, chatId, nodeId]);

  const cancel = useCallback(() => {
    ctx.cancel(nodeId);
  }, [ctx, nodeId]);

  return { state, streamingText, streamingReasoning, error, errorStatus, send, cancel };
}
