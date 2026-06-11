// src/components/graph/GraphDock.tsx
// "Ask this graph" — the bottom dock where graph-scoped RAG answers live.
// Every send: retrieve (traverse + rank over exactly this graph's corpus)
// → build the budgeted context block → stream through the normal chat
// machinery into the graph's hidden dock chat. Retrieved nodes glow on
// the canvas; [S#] citations under each answer click through to their
// nodes.
//
// The composer is THE chat Composer — model picker, web search, files,
// cost pill — wired so its sends pass through retrieval first. Three
// modes, owned by the editor: closed (slim bar) · open (split with the
// canvas) · max (the chat takes the whole column, canvas tucked away).

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type Chat, type Message as DbMessage, type RagSourceRef } from "../../lib/db";
import { getOrCreateGraphChat } from "../../lib/knowledge";
import { retrieveForGraph } from "../../lib/graphrag/retrieve";
import { buildGraphContext } from "../../lib/graphrag/prompt";
import { useStream } from "../../hooks/useStream";
import { useStreamsContext } from "../../hooks/StreamsProvider";
import { useToast } from "../ui/Toast";
import { Message } from "../chat/Message";
import { MarkdownBody } from "../chat/MarkdownBody";
import { Composer, type ComposerSendParams } from "../chat/Composer";

export type DockMode = "closed" | "open" | "max";

export interface GraphDockProps {
  graphId:   string;
  graphName: string;
  /** closed (44px bar) · open (split view) · max (chat owns the column). */
  mode:         DockMode;
  onModeChange: (mode: DockMode) => void;
  /** Display label for a graph node (for citation chips). */
  getNodeLabel: (graphNodeId: string) => string;
  /** Light these nodes up on the canvas (retrieval glow). */
  onGlow: (ids: Set<string> | null) => void;
  /** Select + center a node on the canvas (citation chip click). */
  onFocusNode: (graphNodeId: string) => void;
  /** "Add custom model" inside the picker. */
  onOpenSettings?: () => void;
}

export function GraphDock({
  graphId, graphName, mode, onModeChange,
  getNodeLabel, onGlow, onFocusNode, onOpenSettings,
}: GraphDockProps) {
  const toast = useToast();
  const streams = useStreamsContext();

  const expanded = mode !== "closed";
  const [dockChat, setDockChat] = useState<Chat | null>(null);
  const [preparing, setPreparing] = useState(false);   // retrieval in flight
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // The dock chat is created lazily on first expand — closed docks cost
  // nothing.
  useEffect(() => {
    if (!expanded || dockChat || !graphId) return;
    void getOrCreateGraphChat(graphId).then(setDockChat);
  }, [expanded, dockChat, graphId]);
  useEffect(() => { setDockChat(null); }, [graphId]);

  const chatId = dockChat?._id ?? "";
  const nodeId = dockChat?.rootNodeId ?? "";
  const { state, streamingText, streamingReasoning, error, cancel } =
    useStream(chatId, nodeId);

  const messages = useLiveQuery(
    () => (nodeId
      ? db.messages.where("nodeId").equals(nodeId).sortBy("createdAt")
      : Promise.resolve([] as DbMessage[])),
    [nodeId],
    [] as DbMessage[],
  );

  useEffect(() => {
    if (!expanded) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [expanded, messages.length, streamingText, state]);

  // The Composer hands over its params; retrieval runs first, then the
  // context block + [S#] map ride along into the normal send pipeline.
  const handleSend = async (params: ComposerSendParams): Promise<void> => {
    const chat = dockChat ?? await getOrCreateGraphChat(graphId);
    if (!dockChat) setDockChat(chat);
    setPreparing(true);
    try {
      const retrieval = await retrieveForGraph(graphId, params.composerText);
      const ctx = buildGraphContext(retrieval);
      onGlow(ctx.sources.length > 0
        ? new Set(ctx.sources.map(s => s.graphNodeId))
        : null);
      streams.send(chat._id, chat.rootNodeId, {
        ...params,
        graphContext: { text: ctx.text, sources: ctx.sources },
      });
    } catch (err) {
      toast(`Retrieval failed: ${(err as Error).message}`, { kind: "error" });
    } finally {
      setPreparing(false);
    }
  };

  const cited = useMemo(() => {
    const out = new Set<string>();
    for (const m of streamingText.matchAll(/\[S(\d+)\]/g)) out.add(`S${m[1]}`);
    return out;
  }, [streamingText]);

  const heightClass =
    mode === "closed" ? "tw:flex-none tw:h-[44px]"
    : mode === "open" ? "tw:flex-none tw:h-[min(560px,62%)]"
    : "tw:flex-1 tw:min-h-0";

  return (
    <div className={`${heightClass} tw:border-t tw:border-line tw:bg-bg tw:flex tw:flex-col tw:transition-[height] tw:duration-200 tw:ease-[cubic-bezier(0.4,0,0.2,1)]`}>
      <div className="tw:flex-none tw:h-[44px] tw:flex tw:items-center tw:gap-1.5 tw:pl-4 tw:pr-2">
        <button
          className="tw:flex-1 tw:min-w-0 tw:h-full tw:flex tw:items-center tw:gap-2.5 tw:text-left"
          onClick={() => onModeChange(mode === "closed" ? "open" : "closed")}
          aria-expanded={expanded}
          title={expanded ? "Collapse" : "Ask this graph"}
        >
          <svg className={expanded ? "tw:text-teal" : "tw:text-ink-3"} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.5 3.5 H13.5 V11 H8.5 L5.5 13.5 V11 H2.5 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <circle cx="6" cy="7.2" r="0.9" fill="currentColor" />
            <circle cx="8.5" cy="7.2" r="0.9" fill="currentColor" />
            <circle cx="11" cy="7.2" r="0.9" fill="currentColor" />
          </svg>
          <span className="tw:font-display tw:font-semibold tw:text-[14px] tw:tracking-[-0.01em] tw:text-ink tw:truncate">
            Ask this graph
          </span>
          {!expanded && (
            <span className="tw:text-[11.5px] tw:text-ink-4 tw:truncate">
              answers come only from what you've wired in
            </span>
          )}
        </button>

        {expanded && (
          <button
            className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink"
            onClick={() => onModeChange(mode === "max" ? "open" : "max")}
            title={mode === "max" ? "Restore the canvas" : "Maximize the chat"}
            aria-label={mode === "max" ? "Restore the canvas" : "Maximize the chat"}
          >
            {mode === "max" ? (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 2 V6 H2 M10 14 V10 H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 6 L2.5 2.5 M10 10 L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M9.5 2 H14 V6.5 M6.5 14 H2 V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 2 L9.5 6.5 M2 14 L6.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
        )}
        <button
          className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink"
          onClick={() => onModeChange(expanded ? "closed" : "open")}
          title={expanded ? "Collapse" : "Expand"}
          aria-label={expanded ? "Collapse the dock" : "Expand the dock"}
        >
          <svg
            className={`tw:transition-transform tw:duration-200 ${expanded ? "" : "tw:rotate-180"}`}
            width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"
          >
            <path d="M3 6 L8 11 L13 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {expanded && (
        <>
          <div className="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:px-5 tw:py-2 tw:[scrollbar-width:thin] tw:[scrollbar-color:var(--line)_transparent]">
            {messages.length === 0 && state !== "streaming" && (
              <div className="tw:h-full tw:grid tw:place-items-center">
                <div className="tw:text-center tw:max-w-[440px]">
                  <div className="tw:font-display tw:font-semibold tw:text-[17px] tw:text-ink tw:mb-1">
                    Ask "{graphName}" anything.
                  </div>
                  <p className="tw:m-0 tw:text-[13px] tw:text-ink-3 tw:leading-[1.55]">
                    Questions are answered from the chats, branches, and
                    notes wired into this graph — nearest the root wins.
                    Cited nodes glow on the canvas. Pick any model, toggle
                    web search, attach files — same as a normal chat.
                  </p>
                </div>
              </div>
            )}

            <div className="tw:max-w-[780px] tw:mx-auto">
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

              {preparing && state !== "streaming" && (
                <div className="tw:py-2 tw:text-[12px] tw:text-ink-3">
                  retrieving from the graph…
                </div>
              )}
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
              {state === "error" && error && (
                <div className="tw:my-2 tw:py-2 tw:px-3 tw:rounded-[10px] tw:border tw:border-[color-mix(in_oklab,var(--coral)_35%,var(--line))] tw:bg-[color-mix(in_oklab,var(--coral)_10%,var(--bg-3))] tw:text-[12.5px] tw:text-ink">
                  {error}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="tw:flex-none tw:px-5 tw:pb-3.5 tw:pt-1">
            {dockChat ? (
              <Composer
                chatId={dockChat._id}
                currentNodeId={dockChat.rootNodeId}
                streamState={state}
                onSend={handleSend}
                onCancel={cancel}
                {...(onOpenSettings ? { onOpenSettings } : {})}
              />
            ) : (
              <div className="tw:max-w-[780px] tw:mx-auto tw:h-[58px] tw:rounded-[16px] tw:border tw:border-line tw:bg-bg-3 tw:grid tw:place-items-center tw:text-[12px] tw:text-ink-4">
                preparing the graph chat…
              </div>
            )}
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
