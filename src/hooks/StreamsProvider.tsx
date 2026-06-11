// src/hooks/StreamsProvider.tsx
// Global per-nodeId stream store. Multiple branches can stream in parallel
// without sharing visual state — each StreamSlot has its own subscriber
// list so a Stream tail mounted on node A doesn't re-render when node B's
// stream emits a chunk.
//
// Slots are short-lived: on stream completion we drop the slot entirely
// so the persisted Dexie message takes over rendering, and on stream
// error we keep the slot alive in "error" state so the user sees the
// failure message (the next send() to the same nodeId replaces it).
//
// NOTE: stream state is in-memory only. A page reload aborts every
// in-flight stream and clears every slot — out of scope for this beta.

import {
  createContext, useCallback, useContext, useEffect, useMemo,
  useRef, useSyncExternalStore, type ReactNode,
} from "react";
import { streamMessage, type Citation }   from "../lib/stream";
import { buildPathMessages, db, type RagSourceRef } from "../lib/db";
import { resolveModelSync }               from "../lib/models";
import { autoTitleChat } from "../lib/title";
import { registerAborter, unregisterAborter } from "../lib/streamAborts";
import { useSettings }                    from "./useSettings";

export type StreamState = "idle" | "streaming" | "error";

export interface StreamSlotSnapshot {
  chatId:             string;
  nodeId:             string;
  modelId:            string;
  state:              "streaming" | "error";
  streamingText:      string;
  streamingReasoning: string;
  error:              string | null;
  /** HTTP status that produced `error`, when the failure came from a non-OK
   *  OpenRouter response. The UI keys its 401 ("key rejected") recovery flow
   *  off this rather than string-matching the message. */
  errorStatus?:       number;
  startedAt:          number;
}

export interface SendParams {
  modelId:      string;
  composerText: string;
  quote?:       string;
  fileIds?:     string[];
  /** Run an OpenRouter web search for this message. Captured at send time
   *  so the per-message toggle value sticks to this specific stream. */
  webSearch?:   boolean;
  /** Graph-RAG injection (dock chats): retrieval-built system context plus
   *  the [S#]→canvas-node map, persisted onto the assistant message. */
  graphContext?: { text: string; sources: RagSourceRef[] };
}

/** Dock chats grow forever on one node — cap the history sent upstream.
 *  The just-persisted user message is last in the path, so it always
 *  survives the slice. */
const GRAPH_CHAT_HISTORY_MAX = 16;

// Derive a chat/root-node title from the user's first message. Truncates at
// the first user-typed fenced code block (or pasted <document> block) so the
// title reflects the question, not pasted content. Attached-file content never
// reaches composerText — buildPathMessages injects it at prompt time.
function deriveTitle(text: string): string {
  const firstBlock = text.split(/\n\n(?:<document|```)/)[0] ?? text;
  const cleaned    = firstBlock.replace(/\s+/g, " ").trim();
  return cleaned.length > 60 ? cleaned.slice(0, 60).trimEnd() + "…" : cleaned;
}

// ── Internal slot ─────────────────────────────────────────────────────
// A StreamSlot owns its own snapshot + subscriber set. Updates replace
// the snapshot object identity-wise so useSyncExternalStore sees a new
// reference and re-renders subscribers.

interface InternalSlot {
  snapshot:    StreamSlotSnapshot;
  subscribers: Set<() => void>;
  controller:  AbortController;
}

// ── Context shape ─────────────────────────────────────────────────────

interface StreamsContextValue {
  send:    (chatId: string, nodeId: string, params: SendParams) => void;
  cancel:  (nodeId: string) => void;
  getSlotSnapshot:  (nodeId: string) => StreamSlotSnapshot | null;
  subscribeSlot:    (nodeId: string, cb: () => void) => () => void;
  getActiveStreams: () => Set<string>;
  subscribeActive:  (cb: () => void) => () => void;
}

const StreamsContext = createContext<StreamsContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────

export interface StreamsProviderProps {
  children: ReactNode;
}

export function StreamsProvider({ children }: StreamsProviderProps) {
  const { apiKey, prefs } = useSettings();
  // Settings live in refs too so `send`'s captured closure always sees the
  // latest values without forcing every consumer of context to re-render
  // when the user swaps their key or adds a custom model mid-session.
  const apiKeyRef = useRef(apiKey);
  const prefsRef  = useRef(prefs);
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);
  useEffect(() => { prefsRef.current  = prefs;  }, [prefs]);

  // The actual store. A ref so identity is stable for the lifetime of
  // the provider and `send`/`cancel` can mutate without re-creating.
  const slotsRef = useRef<Map<string, InternalSlot>>(new Map());

  // Subscribers for nodeIds whose slot doesn't exist yet. When a slot
  // gets created (send), we drain the matching entry here into the new
  // slot's subscriber set so the subscriber's getSnapshot returns the
  // fresh non-null value on its next read.
  const pendingSubs = useRef<Map<string, Set<() => void>>>(new Map());

  const activeRef     = useRef<Set<string>>(new Set());
  const activeSubsRef = useRef<Set<() => void>>(new Set());

  const recomputeActive = useCallback((): void => {
    const next = new Set<string>();
    for (const [nodeId, slot] of slotsRef.current) {
      if (slot.snapshot.state === "streaming") next.add(nodeId);
    }
    activeRef.current = next;
    for (const cb of activeSubsRef.current) cb();
  }, []);

  const emit = useCallback((slot: InternalSlot): void => {
    for (const cb of slot.subscribers) cb();
  }, []);

  const updateSlot = useCallback((slot: InternalSlot, patch: Partial<StreamSlotSnapshot>): void => {
    slot.snapshot = { ...slot.snapshot, ...patch };
    emit(slot);
  }, [emit]);

  const removeSlot = useCallback((nodeId: string): void => {
    const slot = slotsRef.current.get(nodeId);
    if (!slot) return;
    slotsRef.current.delete(nodeId);
    unregisterAborter(nodeId);
    // Move subscribers BACK to pending so they keep their subscription
    // (and get notified that the snapshot is now null).
    if (slot.subscribers.size > 0) {
      const set = pendingSubs.current.get(nodeId) ?? new Set<() => void>();
      for (const cb of slot.subscribers) set.add(cb);
      pendingSubs.current.set(nodeId, set);
    }
    // Notify them so their getSnapshot() returns null.
    for (const cb of slot.subscribers) cb();
    recomputeActive();
  }, [recomputeActive]);

  const cancel = useCallback((nodeId: string): void => {
    const slot = slotsRef.current.get(nodeId);
    if (!slot) return;
    try { slot.controller.abort(); } catch { /* ignore */ }
    removeSlot(nodeId);
  }, [removeSlot]);

  const send = useCallback((chatId: string, nodeId: string, params: SendParams): void => {
    // Defensive guard: if a stream is already in flight for this node,
    // ignore the second call. The composer's disabled flag should make
    // this unreachable from the UI.
    const existing = slotsRef.current.get(nodeId);
    if (existing && existing.snapshot.state === "streaming") return;

    // Resolves through the live catalog mirror (custom → catalog → legacy
    // slug map), so even historical ids keep working. undefined only when
    // the id is genuinely unknown — e.g. a model OpenRouter removed.
    const model = resolveModelSync(params.modelId, prefsRef.current.customModels);
    if (!model) {
      // Create an error-state slot so the failure surfaces in the UI.
      const errSubs = existing?.subscribers ?? new Set<() => void>();
      // Drain any pending subscribers into the slot.
      const pending = pendingSubs.current.get(nodeId);
      if (pending) {
        for (const cb of pending) errSubs.add(cb);
        pendingSubs.current.delete(nodeId);
      }
      const errSlot: InternalSlot = {
        snapshot: {
          chatId, nodeId, modelId: params.modelId,
          state: "error",
          streamingText: "", streamingReasoning: "",
          error: `Unknown model "${params.modelId}" — it may have been removed from OpenRouter. Pick another model and resend.`,
          startedAt: Date.now(),
        },
        subscribers: errSubs,
        controller:  new AbortController(),
      };
      slotsRef.current.set(nodeId, errSlot);
      emit(errSlot);
      recomputeActive();
      return;
    }

    const controller = new AbortController();
    // Inherit any prior subscribers + drain any pending ones for this node.
    const subs = existing?.subscribers ?? new Set<() => void>();
    const pending = pendingSubs.current.get(nodeId);
    if (pending) {
      for (const cb of pending) subs.add(cb);
      pendingSubs.current.delete(nodeId);
    }
    const slot: InternalSlot = {
      snapshot: {
        chatId, nodeId, modelId: params.modelId,
        state: "streaming",
        streamingText: "", streamingReasoning: "",
        error: null,
        startedAt: Date.now(),
      },
      subscribers: subs,
      controller,
    };
    slotsRef.current.set(nodeId, slot);
    registerAborter(nodeId, controller);
    emit(slot);
    recomputeActive();

    // Kick off the async work — we don't await; send() is fire-and-forget
    // from the caller's perspective. All state updates flow through the
    // slot's emit() so subscribers see them via useSyncExternalStore.
    void (async (): Promise<void> => {
      // Persist user message to Dexie first so it shows up in the path.
      const userMsgId = crypto.randomUUID();
      try {
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

        // Auto-title from the first user message on this node. A node's
        // label should reflect the user's question, not — for branch
        // nodes created from a text selection — a snippet of the prior
        // reply or the "New branch" placeholder. Graph dock chats keep
        // their fixed "<graph> — graph chat" title.
        //
        // When this derived title lands on the chat itself, the run is
        // "armed" for LLM auto-titling: after the first assistant reply
        // persists, onDone fires a background call that swaps in a short
        // topic title (compare-and-swap in lib/title.ts — a user rename
        // mid-flight wins).
        let autoTitleExpected: string | null = null;
        const chatRecord = await db.chats.get(chatId);
        if (chatRecord && !chatRecord.graphId) {
          // "First user message on this node" = the message we just added
          // is the only user-role message under this nodeId.
          const nodeMsgs    = await db.messages.where("nodeId").equals(nodeId).toArray();
          const userMsgs    = nodeMsgs.filter(m => m.role === "user");
          const isFirstUser = userMsgs.length === 1;

          if (isFirstUser) {
            const title = deriveTitle(params.composerText);
            if (nodeId === chatRecord.rootNodeId) {
              // Root node: fires while the chat title is still the default
              // placeholder — or still "derived", which re-fires after a
              // failed first send (onError deletes the user message but
              // leaves the derived title behind; the retry must re-derive
              // and re-arm). User-chosen titles (starter chips: titleSource
              // undefined; renames: "manual") are never touched. The guard
              // is re-checked inside a transaction so a rename committing
              // mid-send can't be clobbered — or downgraded to "derived",
              // which would let the LLM title overwrite it.
              autoTitleExpected = await db.transaction("rw", db.chats, db.nodes, async () => {
                const chat = await db.chats.get(chatId);
                if (!chat) return null;
                if (chat.title !== "New chat" && chat.titleSource !== "derived") return null;
                const next = title || chat.title;
                await db.chats.update(chatId, {
                  title: next, titleSource: "derived", updatedAt: Date.now(),
                });
                if (title) await db.nodes.update(chat.rootNodeId, { label: title });
                return next;
              });
            } else if (title) {
              // Non-root branch node: retitle from the question,
              // overwriting the selected-quote / "New branch" placeholder.
              await db.nodes.update(nodeId, { label: title });
            }
          }
        }

        // Build full path context from Dexie. The user message we just
        // added is the CURRENT request — it must be the last message in
        // the request body, not dropped.
        let pathMessages = await buildPathMessages(chatId, nodeId);
        if (params.graphContext) {
          pathMessages = pathMessages.slice(-GRAPH_CHAT_HISTORY_MAX);
        }

        let fullContent   = "";
        let fullReasoning = "";
        let citations: Citation[] = [];

        await streamMessage({
          apiKey: apiKeyRef.current,
          openRouterId: model.openRouterId,
          messages: pathMessages,
          ...(params.graphContext ? { systemExtra: params.graphContext.text } : {}),
          model,
          signal: controller.signal,
          webSearch: params.webSearch ?? false,

          onCitations: (list) => { citations = list; },

          onChunk: (text) => {
            fullContent += text;
            // Slot may have been removed already (cancel/delete) — guard.
            const live = slotsRef.current.get(nodeId);
            if (!live || live !== slot) return;
            updateSlot(slot, {
              streamingText: slot.snapshot.streamingText + text,
            });
          },

          onReasoning: (text) => {
            fullReasoning += text;
            const live = slotsRef.current.get(nodeId);
            if (!live || live !== slot) return;
            updateSlot(slot, {
              streamingReasoning: slot.snapshot.streamingReasoning + text,
            });
          },

          onDone: async ({ inputTokens, outputTokens, costUsd }) => {
            // Persist assistant message — reasoning is optional separate
            // field so the UI can render it in a collapsible "Thinking"
            // section.
            await db.messages.add({
              _id:          crypto.randomUUID(),
              nodeId,
              chatId,
              role:         "assistant",
              content:      fullContent,
              ...(fullReasoning ? { reasoning: fullReasoning } : {}),
              ...(citations.length ? { citations } : {}),
              ...(params.graphContext?.sources.length
                ? { ragSources: params.graphContext.sources }
                : {}),
              modelId:      params.modelId,
              costUsd,
              inputTokens,
              outputTokens,
              pathDepth:    pathMessages.length,
              createdAt:    Date.now(),
            });
            await db.chats.update(chatId, { updatedAt: Date.now() });

            // First exchange complete — swap the derived title for a short
            // LLM topic title in the background. Fire-and-forget: it never
            // throws and a failure just keeps the derived title.
            if (autoTitleExpected !== null) {
              void autoTitleChat({
                chatId,
                expectedTitle: autoTitleExpected,
                question:      params.composerText,
                answer:        fullContent,
                apiKey:        apiKeyRef.current,
                customModels:  prefsRef.current.customModels,
              });
            }

            // Drop the slot — the persisted assistant message takes over
            // rendering. We only do this if our slot is still the live one
            // (cancel/delete may have replaced us).
            const live = slotsRef.current.get(nodeId);
            if (live === slot) removeSlot(nodeId);
          },

          onError: async (msg, status) => {
            // Remove the orphan user message we persisted up top.
            try { await db.messages.delete(userMsgId); } catch { /* ignore */ }

            const live = slotsRef.current.get(nodeId);
            if (!live || live !== slot) return;
            // Keep the slot alive in "error" state so the user sees the
            // message. The next send() to this nodeId replaces it.
            updateSlot(slot, {
              state: "error",
              streamingText: "",
              streamingReasoning: "",
              error: msg,
              ...(status !== undefined ? { errorStatus: status } : {}),
            });
            unregisterAborter(nodeId);
            recomputeActive();
            console.error("Stream error:", msg, status);
          },
        });

        // streamMessage returns silently on AbortError without calling
        // onDone/onError. cancel() removes the slot itself, but external
        // aborts (abortNodes() from db.ts cascade deletes) rely on this
        // cleanup — otherwise the slot leaks in "streaming" state forever.
        if (controller.signal.aborted && slotsRef.current.get(nodeId) === slot) {
          removeSlot(nodeId);
        }
      } catch (err) {
        // streamMessage swallows its own errors via onError, but defensive:
        // any unexpected throw (e.g. buildPathMessages) lands here.
        const live = slotsRef.current.get(nodeId);
        if (!live || live !== slot) return;
        try { await db.messages.delete(userMsgId); } catch { /* ignore */ }
        const message = err instanceof Error ? err.message : String(err);
        updateSlot(slot, {
          state: "error",
          streamingText: "",
          streamingReasoning: "",
          error: message,
        });
        unregisterAborter(nodeId);
        recomputeActive();
        console.error("Stream error (outer):", err);
      }
    })();
  }, [recomputeActive, removeSlot, emit, updateSlot]);

  // ── Subscription plumbing ─────────────────────────────────────────
  // subscribeSlot routes the callback to the right place: if the slot
  // exists, attach to its subscriber set; otherwise park the callback in
  // `pendingSubs` until `send` creates the slot and drains it.

  const subscribeSlot = useCallback((nodeId: string, cb: () => void): (() => void) => {
    const slot = slotsRef.current.get(nodeId);
    if (slot) {
      slot.subscribers.add(cb);
      return () => {
        const live = slotsRef.current.get(nodeId);
        if (live) live.subscribers.delete(cb);
        const pend = pendingSubs.current.get(nodeId);
        if (pend) {
          pend.delete(cb);
          if (pend.size === 0) pendingSubs.current.delete(nodeId);
        }
      };
    }
    const set = pendingSubs.current.get(nodeId) ?? new Set<() => void>();
    set.add(cb);
    pendingSubs.current.set(nodeId, set);
    return () => {
      const live = slotsRef.current.get(nodeId);
      if (live) live.subscribers.delete(cb);
      const pend = pendingSubs.current.get(nodeId);
      if (pend) {
        pend.delete(cb);
        if (pend.size === 0) pendingSubs.current.delete(nodeId);
      }
    };
  }, []);

  const getSlotSnapshot = useCallback((nodeId: string): StreamSlotSnapshot | null => {
    const slot = slotsRef.current.get(nodeId);
    if (!slot) return null;
    return slot.snapshot;
  }, []);

  const subscribeActive = useCallback((cb: () => void): (() => void) => {
    activeSubsRef.current.add(cb);
    return () => { activeSubsRef.current.delete(cb); };
  }, []);

  const getActiveStreams = useCallback((): Set<string> => activeRef.current, []);

  const value = useMemo<StreamsContextValue>(() => ({
    send,
    cancel,
    getSlotSnapshot,
    subscribeSlot,
    getActiveStreams,
    subscribeActive,
  }), [send, cancel, getSlotSnapshot, subscribeSlot, getActiveStreams, subscribeActive]);

  return (
    <StreamsContext.Provider value={value}>
      {children}
    </StreamsContext.Provider>
  );
}

// ── Public hooks ──────────────────────────────────────────────────────

export function useStreamsContext(): StreamsContextValue {
  const ctx = useContext(StreamsContext);
  if (!ctx) {
    throw new Error("useStreamsContext must be used inside <StreamsProvider>");
  }
  return ctx;
}

/** Subscribe to the slot for a given nodeId. Returns `null` when no slot
 *  exists (i.e. idle). */
export function useStreamSlot(nodeId: string): StreamSlotSnapshot | null {
  const ctx = useStreamsContext();
  // Stable subscribe/getSnapshot identities per nodeId so React doesn't
  // tear down + re-create the subscription on each render.
  const subscribe = useCallback(
    (cb: () => void) => ctx.subscribeSlot(nodeId, cb),
    [ctx, nodeId],
  );
  const getSnapshot = useCallback(
    () => ctx.getSlotSnapshot(nodeId),
    [ctx, nodeId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The set of nodeIds currently streaming. Identity changes on each
 *  add/remove. */
export function useActiveStreams(): Set<string> {
  const ctx = useStreamsContext();
  return useSyncExternalStore(ctx.subscribeActive, ctx.getActiveStreams, ctx.getActiveStreams);
}
