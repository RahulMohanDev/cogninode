// src/components/graph/NewGraphDialog.tsx
// Name-first graph creation: the name becomes the ROOT node's label — the
// anchor every retrieval starts from — so it's worth asking before
// dropping the user onto an empty canvas.

import { useEffect, useRef, useState } from "react";
import { createGraph } from "../../lib/knowledge";
import { useModalBehavior } from "../../hooks/useModalStack";
import { useToast } from "../ui/Toast";

export function NewGraphDialog({
  open, onClose, onCreated,
}: {
  open:      boolean;
  onClose:   () => void;
  onCreated: (graphId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalBehavior(open, onClose, panelRef);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setName("");
    setBusy(false);
  }, [open]);

  if (!open) return null;

  const create = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await createGraph(name.trim() || "New graph");
      onCreated(id);
    } catch (err) {
      toast(`Couldn't create graph: ${(err as Error).message}`, { kind: "error" });
      setBusy(false);
    }
  };

  return (
    <div
      className="tw:fixed tw:inset-0 tw:bg-[color-mix(in_oklab,var(--ink)_30%,transparent)] tw:dark:bg-[var(--veil-black-60)] tw:backdrop-blur-[8px] tw:grid tw:[place-items:start_center] tw:pt-[18vh] tw:z-[200] tw:animate-[fadeIn_0.14s_ease-out]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="New knowledge graph"
        className="tw:w-[min(440px,92vw)] tw:bg-bg-3 tw:border tw:border-line tw:rounded-[16px] tw:shadow-3 tw:overflow-hidden tw:animate-[popUp_0.18s_cubic-bezier(0.34,1.56,0.64,1)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="tw:flex tw:items-center tw:gap-2.5 tw:py-3.5 tw:px-[18px] tw:border-b tw:border-line">
          <svg className="tw:text-teal tw:flex-none" width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="3.5" r="1.9" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="3.5" cy="12.5" r="1.9" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="12.5" cy="12.5" r="1.9" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 5.4 V8 M8 8 L4.5 11 M8 8 L11.5 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <h2 className="tw:flex-1 tw:m-0 tw:font-display tw:font-semibold tw:text-[17px] tw:tracking-[-0.015em] tw:text-ink">New knowledge graph</h2>
          <button
            className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:hover:bg-bg-2 tw:hover:text-ink"
            onClick={onClose}
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="tw:p-[18px] tw:flex tw:flex-col tw:gap-3">
          <div className="tw:flex tw:flex-col tw:gap-1">
            <label htmlFor="new-graph-name" className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">
              What is this graph about?
            </label>
            <input
              id="new-graph-name"
              className="tw:py-2.5 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[14px] tw:outline-none tw:bg-bg tw:text-ink tw:focus:border-teal tw:placeholder:text-ink-4"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void create(); }}
              placeholder="e.g. Interview prep — Java"
              autoFocus
              spellCheck={false}
            />
            <p className="tw:m-0 tw:mt-0.5 tw:text-[11.5px] tw:text-ink-4">
              This names the root node — the anchor your questions start
              from. Drag chats in and wire them up from there.
            </p>
          </div>
          <button
            className="tw:bg-teal tw:text-white tw:py-2.5 tw:px-3.5 tw:rounded-app-sm tw:text-[13.5px] tw:font-medium tw:hover:opacity-90 tw:disabled:opacity-50"
            onClick={() => void create()}
            disabled={busy}
          >
            Create graph
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewGraphDialog;
