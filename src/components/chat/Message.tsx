// src/components/chat/Message.tsx
// Renders a single chat message (user or assistant) with optional file chips,
// a cost footer (assistant), and hover actions for copy / branch / edit.

import { useState, type ReactNode } from "react";
import { useLiveQuery }             from "dexie-react-hooks";
import { db, type Message as DbMessage } from "../../lib/db";
import { formatCost, getModel }     from "../../lib/cost";
import { useSettings }              from "../../hooks/useSettings";

export interface MessageProps {
  message:    DbMessage;
  onBranch?:  (quote?: string) => void;
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

// ── main message ──────────────────────────────────────────────────

export function Message({ message, onBranch }: MessageProps) {
  const { prefs } = useSettings();
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(message.content);

  const isAssistant = message.role === "assistant";
  const model = isAssistant && message.modelId
    ? getModel(message.modelId, prefs.customModels)
    : undefined;

  const initials = model
    ? model.name.split(" ").slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase().slice(0, 2)
    : "";

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(message.content).catch(() => {});
  };

  const handleSaveEdit = async (): Promise<void> => {
    await db.messages.update(message._id, { content: draft });
    setEditing(false);
  };

  return (
    <div className={`msg ${message.role}`}>
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
        {message.quote && (
          <div className="quote-block">
            <span className="quote-from">↳ branched from</span>
            <span className="quote-text">"{message.quote}"</span>
          </div>
        )}

        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void handleSaveEdit()}
            autoFocus
            style={{
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
            }}
          />
        ) : (
          renderBody(message.content)
        )}

        {message.fileIds && message.fileIds.length > 0 && (
          <FileChips fileIds={message.fileIds} />
        )}
      </div>

      {isAssistant && (
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
      )}

      {!isAssistant && (
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
      )}
    </div>
  );
}

export default Message;
