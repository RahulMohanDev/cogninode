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

  const isEmpty = pathMessages.length === 0 && streamState !== "streaming";

  return (
    <div className="stream" ref={ref}>
      {reflectionsMode && (
        <div className="reflect-banner" role="status" aria-live="polite">
          <svg className="rb-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 10 Q10 4 17 10 Q10 16 3 10 Z" stroke="currentColor" strokeWidth="1.6" fill="none"/>
            <circle cx="10" cy="10" r="2" fill="currentColor"/>
          </svg>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div className="rb-title">Reflections — tidying the current path</div>
            <div className="rb-sub">Click to edit. Delete the noise. Merge what belongs together. Press ⌃R to exit.</div>
          </div>
          <div className="rb-actions">
            {collapseAction}
            {onSaveReflection && (
              <button onClick={() => onSaveReflection()} title="Snapshot this path into your reflections">
                Save as reflection
              </button>
            )}
            {onExitReflections && (
              <button className="exit" onClick={() => onExitReflections()}>
                Done
              </button>
            )}
          </div>
        </div>
      )}

      <div className="stream-inner">
        {isEmpty && (
          <div className="empty" style={{ minHeight: 240 }}>
            <div className="empty-inner">
              <p>Send your first message to grow this branch.</p>
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
          <div className="msg assistant">
            <div className="m-head">
              <span>assistant</span>
            </div>
            <div className="m-body streaming-body">
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
            <div className="msg assistant">
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
                    className="btn-primary coral"
                    type="button"
                    onClick={() => onAuthReset?.()}
                  >
                    Clear key &amp; return to setup
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="msg assistant">
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
