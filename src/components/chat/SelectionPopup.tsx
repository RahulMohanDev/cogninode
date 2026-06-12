// Floating popup that appears when the user selects text inside the
// chat stream. Offers two actions, both passing the selection as a quote:
//   • "Branch from selection" — creates a new node and routes the composer to it.
//   • "Continue in chat"      — quotes the passage inline in the current node.

import { useEffect, useRef, useState, type RefObject } from "react";

export interface SelectionInfo {
  text: string;
  rect: { top: number; left: number; width: number; height: number };
}

export interface SelectionPopupProps {
  streamRef:  RefObject<HTMLElement | null>;
  onBranch:   (selectionText: string) => void;
  /** Attach the selection as context and keep going in the current chat
   *  (no new branch). */
  onContinue: (selectionText: string) => void;
}

export function SelectionPopup({ streamRef, onBranch, onContinue }: SelectionPopupProps) {
  const [sel, setSel] = useState<SelectionInfo | null>(null);
  const selRef = useRef<SelectionInfo | null>(null);
  selRef.current = sel;

  useEffect(() => {
    const handler = (): void => {
      // Run on the next frame so selection has settled.
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
          setSel(null);
          return;
        }
        const text = selection.toString().trim();
        if (text.length < 3) { setSel(null); return; }

        // Only fire if the selection started inside the stream container.
        const container = streamRef.current;
        if (!container) { setSel(null); return; }
        let node: globalThis.Node | null = selection.anchorNode;
        let inside = false;
        while (node) {
          if (node === container) { inside = true; break; }
          node = node.parentNode;
        }
        if (!inside) { setSel(null); return; }

        const range = selection.getRangeAt(0);
        const rect  = range.getBoundingClientRect();
        setSel({
          text,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        });
      }, 1);
    };

    document.addEventListener("mouseup", handler);
    document.addEventListener("keyup",   handler);
    const onScroll = (): void => { if (selRef.current) handler(); };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("mouseup", handler);
      document.removeEventListener("keyup",   handler);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [streamRef]);

  if (!sel) return null;

  const top  = Math.max(70, sel.rect.top - 50);
  const left = Math.max(10, sel.rect.left + sel.rect.width / 2 - 90);

  const close = (): void => {
    setSel(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="tw:fixed tw:bg-ink tw:text-bg tw:rounded-app-sm tw:p-[5px] tw:flex tw:gap-px tw:shadow-[0_16px_40px_-14px_rgba(0,0,0,0.4)] tw:z-[100] tw:animate-[popUp_0.12s_ease-out] tw:text-[12px]" style={{ top, left }}>
      <button
        className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-2.5 tw:rounded-[6px] tw:whitespace-nowrap tw:bg-coral tw:text-white tw:hover:bg-[#ff4520]"
        onClick={() => { onBranch(sel.text); close(); }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <circle cx="4"  cy="3"  r="1.6" fill="currentColor" />
          <circle cx="12" cy="3"  r="1.6" fill="currentColor" />
          <circle cx="8"  cy="13" r="1.6" fill="currentColor" />
          <path d="M4 4.5 V8 H12 V4.5 M8 8 V11.5" stroke="currentColor"
                strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Branch from selection
      </button>
      <span className="tw:w-px tw:bg-[var(--veil-white-14)] tw:dark:bg-[color-mix(in_oklab,var(--bg)_22%,transparent)] tw:my-1 tw:mx-px" />
      <button
        className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-2.5 tw:rounded-[6px] tw:whitespace-nowrap tw:hover:bg-[var(--veil-white-14)] tw:dark:hover:bg-[color-mix(in_oklab,var(--bg)_18%,transparent)]"
        onClick={() => { onContinue(sel.text); close(); }}
        title="Quote this passage and keep going in this chat"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M3 5 H13 M3 8 H10 M3 11 H7" stroke="currentColor"
                strokeWidth="1.4" strokeLinecap="round" />
          <path d="M10.5 11.5 L13 9 M13 9 L13 13 M13 9 L9 13" stroke="currentColor"
                strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Continue in chat
      </button>
      <span className="tw:w-px tw:bg-[var(--veil-white-14)] tw:dark:bg-[color-mix(in_oklab,var(--bg)_22%,transparent)] tw:my-1 tw:mx-px" />
      <button className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-2.5 tw:rounded-[6px] tw:whitespace-nowrap tw:hover:bg-[var(--veil-white-14)] tw:dark:hover:bg-[color-mix(in_oklab,var(--bg)_18%,transparent)]" onClick={close} title="Close">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default SelectionPopup;
