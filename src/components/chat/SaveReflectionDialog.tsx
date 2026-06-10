// src/components/chat/SaveReflectionDialog.tsx
// Confirm-and-customise step for "Save as reflection". Replaces the old
// fire-and-forget save (which gave no feedback and could fail silently):
// shows what's about to be snapshotted (message count, size), lets the user
// edit the title and opt into including model reasoning, then saves with
// explicit success/error toasts.

import { useEffect, useRef, useState } from "react";

import {
  buildReflectionDraft,
  saveReflection,
  REFLECTION_SIZE_WARN_BYTES,
  type ReflectionDraft,
} from "../../lib/reflections";
import { useModalBehavior } from "../../hooks/useModalStack";
import { useToast }         from "../ui/Toast";

export interface SaveReflectionDialogProps {
  open:    boolean;
  chatId:  string;
  nodeId:  string;
  onClose: () => void;
}

function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1)  return "< 1 KB";
  if (kb < 10) return `${kb.toFixed(1)} KB`;
  return `${Math.round(kb)} KB`;
}

export function SaveReflectionDialog({ open, chatId, nodeId, onClose }: SaveReflectionDialogProps) {
  const toast = useToast();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [includeReasoning, setIncludeReasoning] = useState(false);
  const [draft, setDraft] = useState<ReflectionDraft | null>(null);
  const [title, setTitle] = useState("");
  const titleDirty = useRef(false);
  const [busy, setBusy] = useState(false);

  useModalBehavior(open, onClose, panelRef);

  // Fresh state every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setIncludeReasoning(false);
    setDraft(null);
    setTitle("");
    titleDirty.current = false;
    setBusy(false);
  }, [open]);

  // (Re)build the draft on open and whenever the reasoning toggle flips.
  // The path is captured from chatId/nodeId at open time, so a later node
  // switch can't redirect the save.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    void buildReflectionDraft(chatId, nodeId, { includeReasoning }).then(d => {
      if (cancelled) return;
      setDraft(d);
      if (d && !titleDirty.current) setTitle(d.title);
    });
    return () => { cancelled = true; };
  }, [open, chatId, nodeId, includeReasoning]);

  if (!open) return null;

  const empty   = draft !== null && draft.messageCount === 0;
  const canSave = !!draft && !empty && !busy;
  const oversize = !!draft && draft.sizeBytes > REFLECTION_SIZE_WARN_BYTES;

  const handleSave = async (): Promise<void> => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await saveReflection({ chatId, nodeId, title, body: draft.body });
      toast("Reflection saved", { kind: "success" });
      onClose();
    } catch (err) {
      toast(`Couldn't save reflection: ${(err as Error).message}`, { kind: "error" });
      setBusy(false);
    }
  };

  return (
    <div
      className="tw:fixed tw:inset-0 tw:bg-[color-mix(in_oklab,var(--ink)_30%,transparent)] tw:dark:bg-[var(--veil-black-60)] tw:backdrop-blur-[8px] tw:grid tw:[place-items:start_center] tw:pt-[14vh] tw:z-[200] tw:animate-[fadeIn_0.14s_ease-out]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Save reflection"
        className="tw:w-[min(520px,92vw)] tw:bg-bg-3 tw:border tw:border-line tw:rounded-[16px] tw:shadow-3 tw:overflow-hidden tw:animate-[popUp_0.18s_cubic-bezier(0.34,1.56,0.64,1)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="tw:flex tw:items-center tw:gap-2.5 tw:py-3.5 tw:px-[18px] tw:border-b tw:border-line">
          <svg className="tw:text-lilac tw:flex-none" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 10 Q10 4 17 10 Q10 16 3 10 Z" stroke="currentColor" strokeWidth="1.6" fill="none"/>
            <circle cx="10" cy="10" r="2" fill="currentColor"/>
          </svg>
          <h2 className="tw:flex-1 tw:m-0 tw:font-display tw:font-semibold tw:text-[17px] tw:tracking-[-0.015em] tw:text-ink">Save reflection</h2>
          <button
            className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink"
            onClick={onClose}
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="tw:p-[18px] tw:flex tw:flex-col tw:gap-3.5">
          {empty ? (
            <p className="tw:m-0 tw:text-[13px] tw:text-ink-3">
              Nothing to save yet — this branch has no messages.
            </p>
          ) : (
            <>
              <div className="tw:flex tw:flex-col tw:gap-1">
                <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3" htmlFor="reflection-title">Title</label>
                <input
                  id="reflection-title"
                  className="tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[14px] tw:outline-none tw:bg-bg-3 tw:text-ink tw:transition-[border-color] tw:duration-[120ms] tw:ease-[ease] tw:focus:border-lilac"
                  value={title}
                  onChange={e => { titleDirty.current = true; setTitle(e.target.value); }}
                  onKeyDown={e => { if (e.key === "Enter") void handleSave(); }}
                  placeholder="Reflection"
                  autoFocus
                  spellCheck={false}
                />
              </div>

              <label className="tw:flex tw:items-start tw:gap-2.5 tw:cursor-pointer tw:select-none">
                <input
                  type="checkbox"
                  checked={includeReasoning}
                  onChange={e => setIncludeReasoning(e.target.checked)}
                  disabled={!draft?.hasReasoning}
                  style={{ accentColor: "var(--lilac)", marginTop: 3 }}
                />
                <span className="tw:flex tw:flex-col tw:gap-0.5">
                  <span className={`tw:text-[13px] ${draft?.hasReasoning ? "tw:text-ink" : "tw:text-ink-3"}`}>Include model reasoning</span>
                  <span className="tw:text-[12px] tw:text-ink-3">
                    {draft?.hasReasoning
                      ? "Adds each reasoning trace as a quoted block above its answer."
                      : "No messages on this path carry a reasoning trace."}
                  </span>
                </span>
              </label>

              <div className="tw:font-mono tw:text-[11px] tw:text-ink-3 tw:flex tw:items-center tw:gap-2">
                {draft ? (
                  <>
                    <span>{draft.messageCount} message{draft.messageCount === 1 ? "" : "s"}</span>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span>{formatKb(draft.sizeBytes)}</span>
                  </>
                ) : (
                  <span>Collecting path…</span>
                )}
              </div>

              {oversize && (
                <p className="tw:m-0 tw:text-[12px] tw:text-coral tw:bg-coral-tint tw:dark:bg-[color-mix(in_oklab,var(--coral)_14%,transparent)] tw:py-2 tw:px-3 tw:rounded-app-xs">
                  This reflection is large ({draft ? formatKb(draft.sizeBytes) : ""}) and will grow
                  your browser storage accordingly.
                </p>
              )}
            </>
          )}

          <div className="tw:flex tw:gap-2 tw:justify-end tw:mt-0.5">
            <button
              className="tw:bg-bg-3 tw:text-ink tw:py-2 tw:px-4 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:border-ink-3"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="tw:bg-lilac tw:text-white tw:py-2 tw:px-4 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:bg-[#6b4cf0] tw:disabled:opacity-50 tw:disabled:cursor-not-allowed"
              onClick={() => void handleSave()}
              disabled={!canSave}
            >
              {busy ? "Saving…" : "Save reflection"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SaveReflectionDialog;
