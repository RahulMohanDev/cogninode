// src/components/chat/Message.tsx
// Renders a single chat message (user or assistant) with optional file chips,
// a cost footer (assistant), and hover actions for copy / branch / edit.
//
// When `reflectionsMode` is true the message exposes always-visible
// edit / delete / merge affordances and the body becomes click-to-edit.
// Delete and merge run in a single Dexie transaction.

import {
  useEffect,
  useState,
  useCallback,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import { useLiveQuery }     from "dexie-react-hooks";
import { db, type Message as DbMessage } from "../../lib/db";
import { formatCost }       from "../../lib/cost";
import { useModels }        from "../../hooks/ModelsProvider";
import { MarkdownBody }     from "./MarkdownBody";
import { Reasoning }        from "./Reasoning";

// Tiptap + tiptap-markdown + prosemirror together are ~600KB unminified.
// Lazy-load the editor so it only ships to the user the first time they
// open an edit affordance. The same import surface is re-used by both the
// hover-edit and reflections-mode entry points. We avoid any static
// import from `lib/markdown` in this file so Rollup can hoist the editor
// into its own async chunk.
const RichEditor = lazy(() => import("../../lib/markdown"));

export interface MessageProps {
  message:        DbMessage;
  onBranch?:      (quote?: string) => void;
  reflectionsMode?: boolean;
  /** Previous message in this node, if any — required for the merge affordance. */
  prevMessage?:   DbMessage;
}

// ── file chips ────────────────────────────────────────────────────

function FileChips({ fileIds }: { fileIds: string[] }) {
  const files = useLiveQuery(
    () => db.files.where("_id").anyOf(fileIds).toArray(),
    [fileIds.join(",")],
  );

  if (!files || files.length === 0) return null;

  return (
    <div className="tw:flex tw:flex-wrap tw:gap-1.5 tw:p-0 tw:mt-1.5">
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
          <span key={file._id} className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1 tw:pr-2.5 tw:pl-1.5 tw:bg-bg-2 tw:border tw:border-line tw:rounded-[999px] tw:text-[12px] tw:text-ink">
            <span className={`tw:w-[22px] tw:h-[22px] tw:rounded-[5px] tw:grid tw:place-items-center tw:font-mono tw:text-[9px] tw:font-bold tw:text-white tw:tracking-[-0.02em] ${file.kind === "code" ? "tw:bg-[#2c2c2c] tw:dark:bg-[#4a4135]" : file.kind === "pdf" ? "tw:bg-[#e35d4d]" : "tw:bg-teal"}`}>
              {iconLabel}
            </span>
            {file.name}
          </span>
        );
      })}
    </div>
  );
}

// ── sources list ──────────────────────────────────────────────────
// Numbered list of web-search citations captured from OpenRouter's `web`
// plugin. Rendered below the answer body when the message has citations.

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function Sources({ citations }: { citations: NonNullable<DbMessage["citations"]> }) {
  return (
    <div className="tw:mt-3 tw:pt-2.5 tw:border-t tw:border-line">
      <div className="tw:font-mono tw:text-[11px] tw:uppercase tw:tracking-[0.08em] tw:text-ink-3 tw:mb-1.5">Sources</div>
      <ol className="tw:my-0 tw:pl-5 tw:flex tw:flex-col tw:gap-1">
        {citations.map((c, i) => {
          const host = hostnameOf(c.url);
          return (
            <li key={`${c.url}-${i}`} className="tw:text-[13px] tw:text-ink-3">
              <a className="tw:text-ink tw:no-underline tw:border-b tw:border-b-line tw:hover:text-coral tw:hover:border-b-coral" href={c.url} target="_blank" rel="noopener noreferrer">
                {c.title || host}
              </a>
              <span className="tw:ml-1.5 tw:font-mono tw:text-[11px] tw:text-ink-4">{host}</span>
            </li>
          );
        })}
      </ol>
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
  const { resolve } = useModels();
  const [editing,    setEditing]    = useState(false);
  const [draft,      setDraft]      = useState(message.content);
  const [confirming, setConfirming] = useState(false);

  const isAssistant = message.role === "assistant";
  const model = isAssistant && message.modelId
    ? resolve(message.modelId)
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
      // Close the editor without writing: `draft` cannot hold in-progress
      // editor content (RichEditor only reports via onSave on blur/⌘↵),
      // and writing it here would clobber external updates (e.g. merge)
      // that landed while the editor was open.
      setEditing(false);
    }
    // intentionally don't include `draft` / `editing` — we only want to react
    // to mode toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reflectionsMode]);

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(message.content).catch(() => {});
  };

  // Persist a markdown payload and close the editor. We compare against the
  // *current* message content to avoid clobbering unchanged rows with a
  // pointless write.
  const handleSaveMarkdown = useCallback(
    (markdown: string): void => {
      const next = markdown.replace(/\s+$/g, "");
      setDraft(next);
      if (next !== message.content) {
        void db.messages.update(message._id, { content: next });
      }
      setEditing(false);
    },
    [message._id, message.content],
  );

  const handleCancelEdit = useCallback((): void => {
    setDraft(message.content);
    setEditing(false);
  }, [message.content]);

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

  // Empty-state placeholder for click-to-edit affordance in reflections mode.
  const emptyHint: ReactNode = (
    <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>
      (empty — click to edit)
    </span>
  );

  // Render the rich editor inside a Suspense boundary so the lazy chunk
  // doesn't crash the message tree while it's resolving.
  const editorPane: ReactNode = (
    <Suspense fallback={<div className="rte-shell rte-loading">Loading editor…</div>}>
      <RichEditor
        initial={draft}
        onSave={handleSaveMarkdown}
        onCancel={handleCancelEdit}
        variant={message.role === "user" ? "inverted" : "default"}
      />
    </Suspense>
  );

  return (
    <div data-msg-id={message._id} className={`msg ${message.role}${reflectionsMode ? " reflecting" : ""} tw:group/msg tw:flex tw:flex-col tw:gap-1.5 tw:relative ${isAssistant ? "tw:items-start" : "tw:items-end"}`}>
      {/* Reflections-mode side handle: delete + merge into previous (if eligible) */}
      {reflectionsMode && (
        <div className={`tw:absolute tw:top-0 tw:flex tw:flex-col tw:gap-1 tw:z-[2] ${isAssistant ? "tw:left-[-44px]" : "tw:left-auto tw:right-[-44px]"}`}>
          {canMerge && (
            <button
              title="Merge into previous"
              className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[7px] tw:bg-bg-3 tw:border tw:border-line tw:text-ink-3 tw:cursor-pointer tw:transition-[border-color,color,background-color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg tw:hover:border-lilac tw:hover:text-lilac"
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
            className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[7px] tw:bg-bg-3 tw:border tw:border-line tw:text-ink-3 tw:cursor-pointer tw:transition-[border-color,color,background-color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg tw:hover:border-coral tw:hover:text-coral"
            onClick={() => setConfirming(true)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 5 H13 M6 5 V3 H10 V5 M5 5 V13 H11 V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}

      <div className="tw:flex tw:items-center tw:gap-2 tw:font-mono tw:text-[10px] tw:tracking-[0.1em] tw:text-ink-3 tw:uppercase">
        {isAssistant ? (
          <>
            {model && (
              <span className="tw:w-[18px] tw:h-[18px] tw:rounded-[50%] tw:grid tw:place-items-center tw:text-white tw:text-[9px] tw:font-bold tw:tracking-[-0.04em]" style={{ background: "var(--ink-2)" }}>
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
            className="tw:flex tw:flex-col tw:gap-[3px] tw:py-[7px] tw:pr-2.5 tw:pl-3 tw:border-l-[3px] tw:border-l-coral tw:bg-[color-mix(in_oklab,var(--bg)_22%,transparent)] tw:rounded-[4px_8px_8px_4px] tw:text-[12px] tw:leading-[1.4] tw:mb-2 tw:cursor-pointer"
            onClick={() => void handleGoToSource()}
            title="Go to source branch"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void handleGoToSource(); } }}
          >
            <span className="tw:font-mono tw:text-[9px] tw:tracking-[0.12em] tw:uppercase tw:opacity-65">↳ branched from</span>
            <span className="tw:italic tw:font-serif tw:text-[14px]">"{message.quote}"</span>
          </div>
        )}

        {isAssistant && message.reasoning && (
          <Reasoning text={message.reasoning} />
        )}

        {editing ? (
          editorPane
        ) : reflectionsMode ? (
          // Click-to-edit affordance: visible dashed outline replicates the design.
          <div
            onClick={() => setEditing(true)}
            title="Click to edit"
            role="button"
            tabIndex={0}
            aria-label="Edit message"
            onKeyDown={e => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditing(true);
              }
            }}
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
            {message.content.trim()
              ? <MarkdownBody text={message.content} />
              : emptyHint}
          </div>
        ) : (
          <MarkdownBody text={message.content} />
        )}

        {isAssistant && message.citations && message.citations.length > 0 && (
          <Sources citations={message.citations} />
        )}

        {message.fileIds && message.fileIds.length > 0 && (
          <FileChips fileIds={message.fileIds} />
        )}
      </div>

      {/* Inline delete-confirm pill replaces the action row while pending. */}
      {confirming ? (
        <div className="tw:flex tw:items-center tw:font-mono tw:text-[11px] tw:text-ink-3 tw:mt-1 tw:justify-end tw:gap-1.5">
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
        <div className="tw:flex tw:items-center tw:gap-3 tw:font-mono tw:text-[11px] tw:text-ink-3 tw:mt-1">
          <span className="tw:inline-flex tw:items-center tw:gap-[5px] tw:bg-bg-2 tw:py-[3px] tw:px-2 tw:rounded-[999px]">
            <span className="tw:w-[5px] tw:h-[5px] tw:rounded-[50%] tw:bg-teal" />
            {typeof message.costUsd === "number" ? formatCost(message.costUsd) : "—"}
            {typeof message.inputTokens === "number" && typeof message.outputTokens === "number" && (
              <span className="tw:font-mono tw:text-[11px] tw:text-ink-3 tw:tracking-[0.02em]">
                &nbsp;·&nbsp;{message.inputTokens.toLocaleString()} in + {message.outputTokens.toLocaleString()} out
                {typeof message.pathDepth === "number" && (
                  <>&nbsp;·&nbsp;{message.pathDepth}-node path</>
                )}
              </span>
            )}
          </span>
          <div className="tw:flex tw:items-center tw:gap-0.5 tw:ml-auto tw:opacity-0 tw:transition-opacity tw:duration-[120ms] tw:ease-[ease] tw:group-hover/msg:opacity-100 tw:focus-within:opacity-100">
            <button className="tw:w-[26px] tw:h-[26px] tw:grid tw:place-items-center tw:rounded-[5px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink" title="Branch from this" onClick={() => onBranch?.(undefined)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <circle cx="4"  cy="3"  r="1.6" fill="currentColor" />
                <circle cx="12" cy="3"  r="1.6" fill="currentColor" />
                <circle cx="8"  cy="13" r="1.6" fill="currentColor" />
                <path d="M4 4.5 V8 H12 V4.5 M8 8 V11.5" stroke="currentColor"
                      strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <button className="tw:w-[26px] tw:h-[26px] tw:grid tw:place-items-center tw:rounded-[5px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink" title="Copy" onClick={handleCopy}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <path d="M3 11 V3 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <button className="tw:w-[26px] tw:h-[26px] tw:grid tw:place-items-center tw:rounded-[5px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink" title={editing ? "Save edit" : "Edit (reflections)"} onClick={() => {
              if (editing) handleSaveMarkdown(draft);
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
        <div className="tw:flex tw:items-center tw:gap-3 tw:font-mono tw:text-[11px] tw:text-ink-3 tw:mt-1">
          <div className="tw:flex tw:items-center tw:gap-0.5 tw:ml-auto tw:opacity-0 tw:transition-opacity tw:duration-[120ms] tw:ease-[ease] tw:group-hover/msg:opacity-100 tw:focus-within:opacity-100">
            <button className="tw:w-[26px] tw:h-[26px] tw:grid tw:place-items-center tw:rounded-[5px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink" title="Copy" onClick={handleCopy}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <path d="M3 11 V3 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <button className="tw:w-[26px] tw:h-[26px] tw:grid tw:place-items-center tw:rounded-[5px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink" title={editing ? "Save edit" : "Edit"} onClick={() => {
              if (editing) handleSaveMarkdown(draft);
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
