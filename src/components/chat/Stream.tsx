// src/components/chat/Stream.tsx
// Renders the conversation along root → currentNodeId. Mounts the live
// streaming-tail message when useStream is active, auto-scrolls on new
// content, and exposes a ref the SelectionPopup attaches to.
//
// When `reflectionsMode` is true the per-node banner is rendered above
// the stream and each message receives the visible edit/delete/merge
// affordances via its own props.

import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import { useLiveQuery }      from "dexie-react-hooks";
import { db, type Message as DbMessage } from "../../lib/db";
import { Message }           from "./Message";
import { MarkdownBody }      from "./MarkdownBody";
import { Reasoning }         from "./Reasoning";

export interface StreamProps {
  chatId:               string;
  currentNodeId:        string;
  /** Scroll to + flash this message once it's rendered (search deep link). */
  focusMessageId?:      string;
  streamState:          "idle" | "streaming" | "error";
  streamingText:        string;
  streamingReasoning?:  string;
  streamError?:         string;
  /** HTTP status behind `streamError`, when it came from a non-OK response.
   *  A 401 swaps the generic error line for the key-rejected recovery card. */
  streamErrorStatus?:   number;
  /** Invoked from the 401 card: clears the rejected key and returns to setup. */
  onAuthReset?:         () => void;
  onBranchFromMessage?: (msg: DbMessage, quote?: string) => void;
  reflectionsMode?:     boolean;
  onExitReflections?:   () => void;
  onSaveReflection?:    () => void;
  /** Optional banner slot — ChatApp injects the "Collapse to one" action
   *  (with its own inline-confirm UI) here so all collapse logic stays
   *  in ChatApp.tsx. Rendered to the LEFT of Save / Done. */
  collapseAction?:      ReactNode;
}

export const Stream = forwardRef<HTMLDivElement, StreamProps>(function Stream(
  {
    currentNodeId,
    focusMessageId,
    streamState,
    streamingText,
    streamingReasoning,
    streamError,
    streamErrorStatus,
    onAuthReset,
    onBranchFromMessage,
    reflectionsMode = false,
    onExitReflections,
    onSaveReflection,
    collapseAction,
  },
  ref,
) {
  // Messages for the current node only — parent-node messages are sent to the
  // model via buildPathMessages but we don't clutter the UI with them. The
  // breadcrumb that used to live here has moved to the TopBar in ChatApp.
  const pathMessages = useLiveQuery(
    () => db.messages
      .where("nodeId").equals(currentNodeId)
      .sortBy("createdAt"),
    [currentNodeId],
  ) ?? [];

  // Auto-scroll bottom on new content.
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [pathMessages.length, streamingText, streamState]);

  // Search deep link: once the target message is rendered, center + flash
  // it. Runs in rAF so it lands after the bottom-scroll effect above and
  // wins the scroll position.
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusMessageId || focusedRef.current === focusMessageId) return;
    if (!pathMessages.some(m => m._id === focusMessageId)) return;
    focusedRef.current = focusMessageId;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-msg-id="${CSS.escape(focusMessageId)}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("search-flash");
        setTimeout(() => el.classList.remove("search-flash"), 1600);
      }
    });
  }, [focusMessageId, pathMessages]);

  const isEmpty = pathMessages.length === 0 && streamState !== "streaming";

  return (
    <div className="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:scroll-smooth tw:pt-8 tw:px-0 tw:pb-[200px] tw:relative" ref={ref}>
      {reflectionsMode && (
        <div className="tw:sticky tw:top-0 tw:z-[5] tw:flex tw:items-center tw:gap-3 tw:py-2.5 tw:px-[22px] tw:bg-lilac tw:text-white tw:dark:text-[#0e0a14] tw:text-[13px] tw:border-b tw:border-b-[color-mix(in_oklab,var(--lilac)_60%,black)]" role="status" aria-live="polite">
          <svg className="tw:w-5 tw:h-5 tw:flex-none" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 10 Q10 4 17 10 Q10 16 3 10 Z" stroke="currentColor" strokeWidth="1.6" fill="none"/>
            <circle cx="10" cy="10" r="2" fill="currentColor"/>
          </svg>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div className="tw:font-medium">Reflections — tidying the current path</div>
            <div className="tw:opacity-[0.78] tw:font-mono tw:text-[11px]">Click to edit. Delete the noise. Merge what belongs together. Press ⌃R to exit.</div>
          </div>
          <div className="tw:ml-auto tw:flex tw:gap-2 tw:flex-none">
            {collapseAction}
            {onSaveReflection && (
              <button className="tw:py-[5px] tw:px-3 tw:rounded-[7px] tw:text-[12px] tw:font-medium tw:border tw:cursor-pointer tw:transition-[background-color] tw:duration-[120ms] tw:ease-[ease] tw:bg-[var(--veil-white-14)] tw:text-white tw:border-[var(--veil-white-18)] tw:hover:bg-[var(--veil-white-22)] tw:dark:bg-[var(--veil-deep-14)] tw:dark:text-[#0e0a14] tw:dark:border-[var(--veil-deep-22)]" onClick={() => onSaveReflection()} title="Snapshot this path into your reflections">
                Save as reflection
              </button>
            )}
            {onExitReflections && (
              <button className="tw:py-[5px] tw:px-3 tw:rounded-[7px] tw:text-[12px] tw:font-medium tw:border tw:cursor-pointer tw:transition-[background-color] tw:duration-[120ms] tw:ease-[ease] tw:bg-white tw:text-lilac tw:border-white tw:hover:bg-[color-mix(in_oklab,white_90%,var(--lilac))] tw:dark:bg-[#0e0a14] tw:dark:text-lilac tw:dark:border-[#0e0a14]" onClick={() => onExitReflections()}>
                Done
              </button>
            )}
          </div>
        </div>
      )}

      <div className="tw:max-w-[780px] tw:mx-auto tw:py-0 tw:px-8 tw:flex tw:flex-col tw:gap-[26px]">
        {isEmpty && (
          <div className="tw:flex-1 tw:grid tw:place-items-center tw:py-[60px] tw:px-8 tw:text-ink-3 tw:min-h-[240px]">
            <div className="tw:text-center tw:max-w-[520px]">
              <p className="tw:text-[16px] tw:text-ink-2 tw:mt-0 tw:mb-6">Send your first message to grow this branch.</p>
            </div>
          </div>
        )}

        {pathMessages.map((msg, i) => {
          const prev = i > 0 ? pathMessages[i - 1] : undefined;
          return (
            <Message
              key={msg._id}
              message={msg}
              reflectionsMode={reflectionsMode}
              {...(prev !== undefined ? { prevMessage: prev } : {})}
              {...(onBranchFromMessage
                ? { onBranch: (quote?: string) => onBranchFromMessage(msg, quote) }
                : {})}
            />
          );
        })}

        {streamState === "streaming" && (
          <div className="msg assistant tw:flex tw:flex-col tw:gap-1.5 tw:relative tw:items-start">
            <div className="tw:flex tw:items-center tw:gap-2 tw:font-mono tw:text-[10px] tw:tracking-[0.1em] tw:text-ink-3 tw:uppercase">
              <span>assistant</span>
            </div>
            <div className="m-body">
              {streamingReasoning ? (
                <Reasoning text={streamingReasoning} streaming />
              ) : null}
              {streamingText
                ? <>
                    <MarkdownBody text={streamingText} />
                    <span className="thinking" aria-hidden="true"><i /></span>
                  </>
                : !streamingReasoning
                  ? <div className="thinking"><i /><i /><i /></div>
                  : null}
            </div>
          </div>
        )}

        {streamState === "error" && (
          streamErrorStatus === 401 ? (
            <div className="msg assistant tw:flex tw:flex-col tw:gap-1.5 tw:relative tw:items-start">
              <div
                className="m-body auth-reset-card"
                role="alert"
                style={{
                  border: "1px solid var(--coral)",
                  borderRadius: 12,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <strong style={{ color: "var(--coral)" }}>
                  Your API key was rejected
                </strong>
                <span style={{ opacity: 0.8 }}>
                  OpenRouter refused this key (HTTP 401) — it may have been
                  revoked or is no longer valid. Clear it and reconnect to
                  continue.
                </span>
                <div>
                  <button
                    className="tw:bg-coral tw:text-bg tw:py-3 tw:px-5 tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:w-full tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:bg-[#ff4520] tw:dark:hover:bg-[color-mix(in_oklab,var(--ink)_88%,var(--bg))]"
                    type="button"
                    onClick={() => onAuthReset?.()}
                  >
                    Clear key &amp; return to setup
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="msg assistant tw:flex tw:flex-col tw:gap-1.5 tw:relative tw:items-start">
              <div className="m-body" style={{ color: "var(--coral)" }}>
                <strong>Stream error:</strong>{" "}
                {streamError ?? "Unknown error — see browser console for details."}
                {streamErrorStatus !== undefined ? ` (HTTP ${streamErrorStatus})` : ""}
              </div>
            </div>
          )
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
});

export default Stream;
