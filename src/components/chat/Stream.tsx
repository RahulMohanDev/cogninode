// src/components/chat/Stream.tsx
// Renders the conversation along root → currentNodeId. Mounts the live
// streaming-tail message when useStream is active, auto-scrolls on new
// content, and exposes a ref the SelectionPopup attaches to.

import { forwardRef, useEffect, useMemo, useRef } from "react";
import { useLiveQuery }      from "dexie-react-hooks";
import { db, type Message as DbMessage } from "../../lib/db";
import { findPath }          from "../../lib/path";
import { Message }           from "./Message";

export interface StreamProps {
  chatId:         string;
  currentNodeId:  string;
  streamState:    "idle" | "streaming" | "error";
  streamingText:  string;
  streamError?:   string;
  onBranchFromMessage?: (msg: DbMessage, quote?: string) => void;
}

export const Stream = forwardRef<HTMLDivElement, StreamProps>(function Stream(
  { chatId, currentNodeId, streamState, streamingText, streamError, onBranchFromMessage },
  ref,
) {
  // Live: all nodes for breadcrumb labels.
  const nodes = useLiveQuery(
    () => db.nodes.where("chatId").equals(chatId).toArray(),
    [chatId],
  ) ?? [];

  // Breadcrumb shows ancestor lineage; the conversation itself only renders
  // messages on the current node. Parent-node messages are still sent to the
  // model via buildPathMessages — we just don't clutter the UI with them.
  const pathNodeIds = useMemo(
    () => findPath(nodes, currentNodeId),
    [nodes, currentNodeId],
  );

  const pathMessages = useLiveQuery(
    () => db.messages
      .where("nodeId").equals(currentNodeId)
      .sortBy("createdAt"),
    [currentNodeId],
  ) ?? [];

  // Breadcrumb labels — root first, then each child node label truncated.
  const breadcrumb = useMemo(() => {
    const map = new Map(nodes.map(n => [n._id, n]));
    return pathNodeIds.map(id => map.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
  }, [nodes, pathNodeIds]);

  // Auto-scroll bottom on new content.
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [pathMessages.length, streamingText, streamState]);

  const isEmpty = pathMessages.length === 0 && streamState !== "streaming";

  return (
    <div className="stream" ref={ref}>
      <div className="stream-inner">
        {breadcrumb.length > 1 && (
          <div className="crumb" style={{ paddingBottom: 0, marginBottom: 4 }}>
            <span className="c-title">root</span>
            {breadcrumb.slice(1).map((n, i) => {
              const label = n.label.length > 24 ? n.label.slice(0, 24) + "…" : n.label;
              return (
                <span key={n._id} style={{ display: "inline-flex", alignItems: "center" }}>
                  <span className="c-sep">›</span>
                  <span className={`c-node d${Math.min(3, i + 1)}`}>
                    <span className="c-dot" />
                    {label}
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {isEmpty && (
          <div className="empty" style={{ minHeight: 240 }}>
            <div className="empty-inner">
              <p>Send your first message to grow this branch.</p>
            </div>
          </div>
        )}

        {pathMessages.map(msg => (
          <Message
            key={msg._id}
            message={msg}
            {...(onBranchFromMessage
              ? { onBranch: (quote?: string) => onBranchFromMessage(msg, quote) }
              : {})}
          />
        ))}

        {streamState === "streaming" && (
          <div className="msg assistant">
            <div className="m-head">
              <span>assistant</span>
            </div>
            <div className="m-body">
              {streamingText
                ? <p>{streamingText}<span className="thinking" style={{ display: "inline-flex", marginLeft: 4 }}><i /></span></p>
                : <div className="thinking"><i /><i /><i /></div>}
            </div>
          </div>
        )}

        {streamState === "error" && (
          <div className="msg assistant">
            <div className="m-body" style={{ color: "var(--coral)" }}>
              <strong>Stream error:</strong> {streamError ?? "Unknown error — see browser console for details."}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
});

export default Stream;
