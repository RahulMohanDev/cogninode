// src/components/graph/GraphDock.tsx
// "Ask this graph" — the collapsible bottom dock where graph-scoped RAG
// answers live. Every send: retrieve (traverse + rank over exactly this
// graph's corpus) → build the budgeted context block → stream through the
// normal chat machinery into the graph's hidden dock chat. Retrieved
// nodes glow on the canvas; [S#] citations under each answer click
// through to their nodes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type Chat, type Message as DbMessage, type RagSourceRef } from "../../lib/db";
import { getOrCreateGraphChat } from "../../lib/knowledge";
import { retrieveForGraph } from "../../lib/graphrag/retrieve";
import { buildGraphContext } from "../../lib/graphrag/prompt";
import { useStream } from "../../hooks/useStream";
import { useStreamsContext } from "../../hooks/StreamsProvider";
import { useSettings } from "../../hooks/useSettings";
import { useModels } from "../../hooks/ModelsProvider";
import { useToast } from "../ui/Toast";
import { Message } from "../chat/Message";
import { MarkdownBody } from "../chat/MarkdownBody";

export interface GraphDockProps {
  graphId:   string;
  graphName: string;
  /** Display label for a graph node (for citation chips). */
  getNodeLabel: (graphNodeId: string) => string;
  /** Light these nodes up on the canvas (retrieval glow). */
  onGlow: (ids: Set<string> | null) => void;
  /** Select + center a node on the canvas (citation chip click). */
  onFocusNode: (graphNodeId: string) => void;
}

export function GraphDock({
  graphId, graphName, getNodeLabel, onGlow, onFocusNode,
}: GraphDockProps) {
  const { prefs } = useSettings();
  const { resolve } = useModels();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [dockChat, setDockChat] = useState<Chat | null>(null);
  const [draft, setDraft] = useState("");
  const [preparing, setPreparing] = useState(false);   // retrieval in flight
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // The dock chat is created lazily on first expand — closed docks cost
  // nothing.
  useEffect(() => {
    if (!open || dockChat || !graphId) return;
    void getOrCreateGraphChat(graphId).then(setDockChat);
  }, [open, dockChat, graphId]);
  useEffect(() => { setDockChat(null); }, [graphId]);

  const chatId = dockChat?._id ?? "";
  const nodeId = dockChat?.rootNodeId ?? "";
  // Slot state through the convenience hook; sends go through the provider
  // directly so a chat created within this very send isn't a stale binding.
  const { state, streamingText, streamingReasoning, error, cancel } =
    useStream(chatId, nodeId);
  const streams = useStreamsContext();

  const messages = useLiveQuery(
    () => (nodeId
      ? db.messages.where("nodeId").equals(nodeId).sortBy("createdAt")
      : Promise.resolve([] as DbMessage[])),
    [nodeId],
    [] as DbMessage[],
  );

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [open, messages.length, streamingText, state]);

  const modelDef = resolve(prefs.defaultModelId);

  const doSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || preparing || state === "streaming") return;
    const chat = dockChat ?? await getOrCreateGraphChat(graphId);
    if (!dockChat) setDockChat(chat);

    setPreparing(true);
    try {
      const retrieval = await retrieveForGraph(graphId, text);
      const ctx = buildGraphContext(retrieval);
      onGlow(ctx.sources.length > 0
        ? new Set(ctx.sources.map(s => s.graphNodeId))
        : null);
      streams.send(chat._id, chat.rootNodeId, {
        modelId:      prefs.defaultModelId,
        composerText: text,
        graphContext: { text: ctx.text, sources: ctx.sources },
      });
      setDraft("");
    } catch (err) {
      toast(`Retrieval failed: ${(err as Error).message}`, { kind: "error" });
    } finally {
      setPreparing(false);
    }
  }, [draft, preparing, state, dockChat, graphId, onGlow, streams,
      prefs.defaultModelId, toast]);

  const cited = useMemo(() => {
    // tags referenced in the latest streaming text — chips light up live.
    const out = new Set<string>();
    for (const m of streamingText.matchAll(/\[S(\d+)\]/g)) out.add(`S${m[1]}`);
    return out;
  }, [streamingText]);

  return (
    <div className={`tw:flex-none tw:border-t tw:border-line tw:bg-bg tw:flex tw:flex-col tw:transition-[height] tw:duration-200 tw:ease-[cubic-bezier(0.4,0,0.2,1)] ${open ? "tw:h-[380px]" : "tw:h-[44px]"}`}>
      <button
        className="tw:flex-none tw:h-[44px] tw:flex tw:items-center tw:gap-2.5 tw:px-4 tw:text-left tw:hover:bg-bg-2"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <svg className={open ? "tw:text-teal" : "tw:text-ink-3"} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 3.5 H13.5 V11 H8.5 L5.5 13.5 V11 H2.5 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="6" cy="7.2" r="0.9" fill="currentColor" />
          <circle cx="8.5" cy="7.2" r="0.9" fill="currentColor" />
          <circle cx="11" cy="7.2" r="0.9" fill="currentColor" />
        </svg>
        <span className="tw:font-display tw:font-semibold tw:text-[14px] tw:tracking-[-0.01em] tw:text-ink tw:flex-1">
          Ask this graph
        </span>
        {!open && (
          <span className="tw:text-[11.5px] tw:text-ink-4">
            answers come only from what you've wired in
          </span>
        )}
        <svg
          className={`tw:text-ink-3 tw:transition-transform tw:duration-200 ${open ? "" : "tw:rotate-180"}`}
          width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"
        >
          <path d="M3 6 L8 11 L13 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:px-4 tw:py-2 tw:[scrollbar-width:thin] tw:[scrollbar-color:var(--line)_transparent]">
            {messages.length === 0 && state !== "streaming" && (
              <div className="tw:h-full tw:grid tw:place-items-center">
                <div className="tw:text-center tw:max-w-[420px]">
                  <div className="tw:font-display tw:font-semibold tw:text-[16px] tw:text-ink tw:mb-1">
                    Ask "{graphName}" anything.
                  </div>
                  <p className="tw:m-0 tw:text-[12.5px] tw:text-ink-3 tw:leading-[1.5]">
                    Questions are answered from the chats, branches, and
                    notes wired into this graph — nearest the root wins.
                    Cited nodes glow on the canvas.
                  </p>
                </div>
              </div>
            )}

            <div className="tw:max-w-[720px] tw:mx-auto">
              {messages.map((m, i) => (
                <div key={m._id}>
                  <Message
                    message={m}
                    {...(i > 0 ? { prevMessage: messages[i - 1]! } : {})}
                  />
                  {m.role === "assistant" && m.ragSources && m.ragSources.length > 0 && (
                    <RagSourceChips
                      sources={m.ragSources}
                      content={m.content}
                      getNodeLabel={getNodeLabel}
                      onFocusNode={onFocusNode}
                      onGlow={onGlow}
                    />
                  )}
                </div>
              ))}

              {state === "streaming" && (
                <div className="tw:py-2">
                  {streamingReasoning && !streamingText && (
                    <div className="tw:text-[12px] tw:text-ink-3 tw:italic tw:mb-1">thinking…</div>
                  )}
                  {streamingText
                    ? <MarkdownBody text={streamingText} />
                    : (
                      <span className="thinking" aria-label="Waiting for the model">
                        <i /><i /><i />
                      </span>
                    )}
                  {cited.size > 0 && (
                    <div className="tw:text-[11px] tw:text-ink-4 tw:mt-1">citing {[...cited].join(", ")}…</div>
                  )}
                </div>
              )}
              {preparing && state !== "streaming" && (
                <div className="tw:py-2 tw:text-[12px] tw:text-ink-3">
                  retrieving from the graph…
                </div>
              )}
              {state === "error" && error && (
                <div className="tw:my-2 tw:py-2 tw:px-3 tw:rounded-[10px] tw:border tw:border-[color-mix(in_oklab,var(--coral)_35%,var(--line))] tw:bg-[color-mix(in_oklab,var(--coral)_10%,var(--bg-3))] tw:text-[12.5px] tw:text-ink">
                  {error}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="tw:flex-none tw:border-t tw:border-line-2 tw:p-3">
            <div className="tw:max-w-[720px] tw:mx-auto tw:flex tw:items-end tw:gap-2">
              <textarea
                className="tw:flex-1 tw:resize-none tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-[10px] tw:bg-bg-3 tw:text-[13.5px] tw:text-ink tw:outline-none tw:focus:border-teal tw:placeholder:text-ink-4 tw:leading-[1.45] tw:max-h-[96px]"
                rows={1}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void doSend();
                  }
                }}
                placeholder={`Ask ${graphName}…`}
                spellCheck={false}
              />
              {state === "streaming" ? (
                <button
                  className="tw:flex-none tw:h-[36px] tw:px-3.5 tw:rounded-[10px] tw:border tw:border-coral tw:text-coral tw:text-[13px] tw:font-medium tw:bg-bg tw:hover:bg-coral-tint"
                  onClick={cancel}
                >
                  Stop
                </button>
              ) : (
                <button
                  className="tw:flex-none tw:h-[36px] tw:px-3.5 tw:rounded-[10px] tw:bg-teal tw:text-white tw:text-[13px] tw:font-medium tw:hover:opacity-90 tw:disabled:opacity-50"
                  onClick={() => void doSend()}
                  disabled={!draft.trim() || preparing}
                >
                  Ask
                </button>
              )}
            </div>
            <div className="tw:max-w-[720px] tw:mx-auto tw:mt-1.5 tw:flex tw:items-center tw:gap-2">
              <span className="tw:font-mono tw:text-[10px] tw:text-ink-4">
                {modelDef ? modelDef.name : prefs.defaultModelId}
              </span>
              <span className="tw:text-[10px] tw:text-ink-4">· grounded in this graph only</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── citation chips ──────────────────────────────────────────────────────

function RagSourceChips({
  sources, content, getNodeLabel, onFocusNode, onGlow,
}: {
  sources:      RagSourceRef[];
  content:      string;
  getNodeLabel: (graphNodeId: string) => string;
  onFocusNode:  (graphNodeId: string) => void;
  onGlow:       (ids: Set<string> | null) => void;
}) {
  const citedTags = useMemo(() => {
    const out = new Set<string>();
    for (const m of content.matchAll(/\[S(\d+)\]/g)) out.add(`S${m[1]}`);
    return out;
  }, [content]);

  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5 tw:mt-[-4px] tw:mb-3">
      <span className="tw:font-mono tw:text-[9px] tw:tracking-[0.1em] tw:uppercase tw:text-ink-4 tw:flex-none">sources</span>
      {sources.map(s => {
        const cited = citedTags.has(s.tag);
        return (
          <button
            key={s.tag}
            className={`tw:inline-flex tw:items-center tw:gap-1 tw:py-0.5 tw:px-2 tw:rounded-[999px] tw:text-[11px] tw:border ${cited ? "tw:border-lilac tw:text-ink tw:bg-[color-mix(in_oklab,var(--lilac)_14%,var(--bg-3))]" : "tw:border-line tw:text-ink-3 tw:bg-bg-3 tw:hover:text-ink tw:hover:border-ink-3"}`}
            onClick={() => onFocusNode(s.graphNodeId)}
            onMouseEnter={() => onGlow(new Set([s.graphNodeId]))}
            title={`Show "${getNodeLabel(s.graphNodeId)}" on the canvas`}
          >
            <span className="tw:font-mono tw:text-[9.5px]">{s.tag}</span>
            <span className="tw:max-w-[160px] tw:truncate">{getNodeLabel(s.graphNodeId)}</span>
          </button>
        );
      })}
    </div>
  );
}

export default GraphDock;
