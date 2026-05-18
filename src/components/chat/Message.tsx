// src/components/chat/Message.tsx
// Renders a single chat message (user or assistant) with optional file chips,
// a cost footer (assistant), and hover actions for copy / branch / edit.
//
// When `reflectionsMode` is true the message exposes always-visible
// edit / delete / merge affordances and the body becomes click-to-edit.
// Delete and merge run in a single Dexie transaction.

import { useEffect, useState, type ReactNode } from "react";
import { useLiveQuery }             from "dexie-react-hooks";
import { db, type Message as DbMessage } from "../../lib/db";
import { formatCost, getModel }     from "../../lib/cost";
import { useSettings }              from "../../hooks/useSettings";

export interface MessageProps {
  message:        DbMessage;
  onBranch?:      (quote?: string) => void;
  reflectionsMode?: boolean;
  /** Previous message in this node, if any — required for the merge affordance. */
  prevMessage?:   DbMessage;
}

// ── tiny markdown renderer ────────────────────────────────────────
// Handles code fences (```), inline `code`, **bold**, paragraphs.
// Intentionally minimal — no syntax highlighting, no link parsing.

type Block =
  | { type: "code"; lang: string; body: string }
  | { type: "p";    body: string };

function tokenize(text: string): Block[] {
  const blocks: Block[] = [];
  const segments = text.split(/```([\s\S]*?)```/);
  segments.forEach((seg, i) => {
    if (i % 2 === 1) {
      const firstBreak = seg.indexOf("\n");
      const lang = firstBreak >= 0 ? seg.slice(0, firstBreak).trim() : "";
      const body = firstBreak >= 0 ? seg.slice(firstBreak + 1) : seg;
      blocks.push({ type: "code", lang, body: body.replace(/\n$/, "") });
    } else {
      const paragraphs = seg.split(/\n{2,}/);
      paragraphs.forEach(p => {
        if (p.trim()) blocks.push({ type: "p", body: p });
      });
    }
  });
  return blocks;
}

function renderInline(text: string, baseKey: string): ReactNode[] {
  // Tokenise **bold** and `inline` while preserving the rest as plain text.
  const out: ReactNode[] = [];
  const re   = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let key  = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(<span key={`${baseKey}-t-${key++}`}>{text.slice(last, m.index)}</span>);
    }
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={`${baseKey}-b-${key++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={`${baseKey}-c-${key++}`}>{tok.slice(1, -1)}</code>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) {
    out.push(<span key={`${baseKey}-t-${key++}`}>{text.slice(last)}</span>);
  }
  return out;
}

function renderBody(text: string): ReactNode {
  if (!text) return null;
  const blocks = tokenize(text);
  return blocks.map((b, i) => {
    if (b.type === "code") {
      return (
        <pre key={`p-${i}`}>
          <code>{b.body}</code>
        </pre>
      );
    }
    // Treat newlines inside a paragraph as line breaks.
    const lines = b.body.split("\n");
    return (
      <p key={`p-${i}`}>
        {lines.map((line, li) => (
          <span key={`l-${li}`}>
            {renderInline(line, `p-${i}-l-${li}`)}
            {li < lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  });
}

// ── file chips ────────────────────────────────────────────────────

function FileChips({ fileIds }: { fileIds: string[] }) {
  const files = useLiveQuery(
    () => db.files.where("_id").anyOf(fileIds).toArray(),
    [fileIds.join(",")],
  );

  if (!files || files.length === 0) return null;

  return (
    <div className="files-row" style={{ padding: 0, marginTop: 6 }}>
      {files.map(file => {
        if (file.kind === "image") {
          return (
            <img
              key={file._id}
              src={file.content}
              alt={file.name}
              style={{
                maxWidth: 220,
                maxHeight: 180,
                borderRadius: 8,
                border: "1px solid var(--line)",
                objectFit: "cover",
              }}
            />
          );
        }
        const iconLabel =
          file.kind === "pdf"  ? "PDF" :
          file.kind === "code" ? "<>"  : "FILE";
        return (
          <span key={file._id} className="file-chip">
            <span className={`fc-icon ${file.kind === "code" ? "code" : file.kind === "pdf" ? "pdf" : "img"}`}>
              {iconLabel}
            </span>
            {file.name}
          </span>
        );
      })}
    </div>
  );
}

// ── merge helper ──────────────────────────────────────────────────
// Collapse `current` into `prev` (same role, same node). prev keeps its
// _id, createdAt, modelId, pathDepth; usage fields sum when both are
// assistant; fileIds concatenate (dedup). Runs in one transaction.

async function mergeIntoPrev(prev: DbMessage, current: DbMessage): Promise<void> {
  const mergedContent = `${prev.content}\n\n${current.content}`;
  const mergedFiles = (() => {
    const a = prev.fileIds ?? [];
    const b = current.fileIds ?? [];
    if (a.length === 0 && b.length === 0) return undefined;
    return Array.from(new Set([...a, ...b]));
  })();

  // Build update with exact-optional spread so we never assign undefined
  // to a field whose type doesn't include it.
  const update: Partial<DbMessage> = { content: mergedContent };
  if (mergedFiles !== undefined) update.fileIds = mergedFiles;

  const bothAssistant = prev.role === "assistant" && current.role === "assistant";
  if (bothAssistant) {
    const sumCost   = (prev.costUsd     ?? 0) + (current.costUsd     ?? 0);
    const sumInTok  = (prev.inputTokens ?? 0) + (current.inputTokens ?? 0);
    const sumOutTok = (prev.outputTokens?? 0) + (current.outputTokens?? 0);
    if (typeof prev.costUsd === "number" || typeof current.costUsd === "number") {
      update.costUsd = sumCost;
    }
    if (typeof prev.inputTokens === "number" || typeof current.inputTokens === "number") {
      update.inputTokens = sumInTok;
    }
    if (typeof prev.outputTokens === "number" || typeof current.outputTokens === "number") {
      update.outputTokens = sumOutTok;
    }
  }

  await db.transaction("rw", db.messages, async () => {
    await db.messages.update(prev._id, update);
    await db.messages.delete(current._id);
  });
}

// ── main message ──────────────────────────────────────────────────

export function Message({ message, onBranch, reflectionsMode = false, prevMessage }: MessageProps) {
  const { prefs } = useSettings();
  const [editing,    setEditing]    = useState(false);
  const [draft,      setDraft]      = useState(message.content);
  const [confirming, setConfirming] = useState(false);

  const isAssistant = message.role === "assistant";
  const model = isAssistant && message.modelId
    ? getModel(message.modelId, prefs.customModels)
    : undefined;

  const initials = model
    ? model.name.split(" ").slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase().slice(0, 2)
    : "";

  // Keep the editor draft in sync if the underlying message changes
  // (e.g. after a merge from another agent / a different reflection action).
  useEffect(() => {
    if (!editing) setDraft(message.content);
  }, [message.content, editing]);

  // Auto-dismiss the inline delete-confirm pill after 4s so it can't linger.
  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  // Leaving reflections mode clears any pending UI state.
  useEffect(() => {
    if (!reflectionsMode) {
      setConfirming(false);
      if (editing) {
        // commit current draft before exit
        void db.messages.update(message._id, { content: draft }).finally(() => setEditing(false));
      }
    }
    // intentionally don't include `draft` / `editing` — we only want to react
    // to mode toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reflectionsMode]);

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(message.content).catch(() => {});
  };

  const handleSaveEdit = async (): Promise<void> => {
    await db.messages.update(message._id, { content: draft });
    setEditing(false);
  };

  const handleDelete = async (): Promise<void> => {
    await db.messages.delete(message._id);
  };

  const canMerge =
    reflectionsMode &&
    !!prevMessage &&
    prevMessage.role === message.role;

  const handleMerge = async (): Promise<void> => {
    if (!prevMessage) return;
    await mergeIntoPrev(prevMessage, message);
  };

  // The "branched from" chip on a branch's first user message jumps the
  // chat's currentNodeId back to this message's parent — i.e. the source
  // branch the user split off from.
  const handleGoToSource = async (): Promise<void> => {
    const node = await db.nodes.get(message.nodeId);
    if (!node?.parentId) return;
    await db.chats.update(message.chatId, { currentNodeId: node.parentId });
  };

  const bodyTextareaStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 80,
    padding: 10,
    border: "1px dashed var(--lilac)",
    borderRadius: 8,
    background: "var(--bg-tint)",
    color: "var(--ink)",
    font: "inherit",
    outline: "none",
    resize: "vertical",
  };

  return (
    <div className={`msg ${message.role}${reflectionsMode ? " reflecting" : ""}`}>
      {/* Reflections-mode side handle: delete + merge into previous (if eligible) */}
      {reflectionsMode && (
        <div className="reflect-handles">
          {canMerge && (
            <button
              title="Merge into previous"
              className="merge"
              onClick={() => void handleMerge()}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 3 V7 Q4 9 8 9 Q12 9 12 7 V3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
                <path d="M8 9 V13 M5.5 10.5 L8 13 L10.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            </button>
          )}
          <button
            title="Delete this message"
            className="delete"
            onClick={() => setConfirming(true)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 5 H13 M6 5 V3 H10 V5 M5 5 V13 H11 V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}

      <div className="m-head">
        {isAssistant ? (
          <>
            {model && (
              <span className="m-avatar" style={{ background: "var(--ink-2)" }}>
                {initials}
              </span>
            )}
            <span>{model?.name ?? "assistant"}</span>
          </>
        ) : (
          <span>You</span>
        )}
      </div>

      <div className="m-body">
        {message.quote && !reflectionsMode && (
          <div
            className="quote-block"
            onClick={() => void handleGoToSource()}
            title="Go to source branch"
            style={{ cursor: "pointer" }}
          >
            <span className="quote-from">↳ branched from</span>
            <span className="quote-text">"{message.quote}"</span>
          </div>
        )}

        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void handleSaveEdit()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSaveEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(message.content);
                setEditing(false);
              }
            }}
            autoFocus
            style={bodyTextareaStyle}
          />
        ) : reflectionsMode ? (
          // Click-to-edit affordance: visible dashed outline replicates the design.
          <div
            onClick={() => setEditing(true)}
            title="Click to edit"
            style={{
              cursor: "text",
              padding: "8px 12px",
              margin: "-8px -12px",
              borderRadius: 8,
              outline: "1px dashed color-mix(in oklab, var(--lilac) 60%, transparent)",
              outlineOffset: 2,
              background: "var(--bg-tint)",
            }}
          >
            {renderBody(message.content) ?? (
              <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>
                (empty — click to edit)
              </span>
            )}
          </div>
        ) : (
          renderBody(message.content)
        )}

        {message.fileIds && message.fileIds.length > 0 && (
          <FileChips fileIds={message.fileIds} />
        )}
      </div>

      {/* Inline delete-confirm pill replaces the action row while pending. */}
      {confirming ? (
        <div
          className="m-foot"
          style={{
            justifyContent: "flex-end",
            gap: 6,
            alignItems: "center",
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          <span style={{ marginRight: 8 }}>Delete this message?</span>
          <button
            onClick={() => void handleDelete()}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: "var(--coral)",
              color: "white",
              fontWeight: 500,
            }}
          >
            yes
          </button>
          <button
            onClick={() => setConfirming(false)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: "var(--bg-3)",
              color: "var(--ink)",
              border: "1px solid var(--line)",
            }}
          >
            cancel
          </button>
        </div>
      ) : isAssistant && !reflectionsMode ? (
        <div className="m-foot">
          <span className="credits">
            <span className="cd" />
            {typeof message.costUsd === "number" ? formatCost(message.costUsd) : "—"}
            {typeof message.inputTokens === "number" && typeof message.outputTokens === "number" && (
              <span className="cr-detail">
                &nbsp;·&nbsp;{message.inputTokens.toLocaleString()} in + {message.outputTokens.toLocaleString()} out
                {typeof message.pathDepth === "number" && (
                  <>&nbsp;·&nbsp;{message.pathDepth}-node path</>
                )}
              </span>
            )}
          </span>
          <div className="m-actions">
            <button title="Branch from this" onClick={() => onBranch?.(undefined)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <circle cx="4"  cy="3"  r="1.6" fill="currentColor" />
                <circle cx="12" cy="3"  r="1.6" fill="currentColor" />
                <circle cx="8"  cy="13" r="1.6" fill="currentColor" />
                <path d="M4 4.5 V8 H12 V4.5 M8 8 V11.5" stroke="currentColor"
                      strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <button title="Copy" onClick={handleCopy}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <path d="M3 11 V3 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <button title={editing ? "Save edit" : "Edit (reflections)"} onClick={() => {
              if (editing) void handleSaveEdit();
              else         setEditing(true);
            }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M3 11 L3 13 L5 13 L13 5 L11 3 Z" stroke="currentColor" strokeWidth="1.4"
                      strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      ) : !isAssistant && !reflectionsMode ? (
        <div className="m-foot">
          <div className="m-actions">
            <button title="Copy" onClick={handleCopy}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <path d="M3 11 V3 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <button title={editing ? "Save edit" : "Edit"} onClick={() => {
              if (editing) void handleSaveEdit();
              else         setEditing(true);
            }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M3 11 L3 13 L5 13 L13 5 L11 3 Z" stroke="currentColor" strokeWidth="1.4"
                      strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Message;
