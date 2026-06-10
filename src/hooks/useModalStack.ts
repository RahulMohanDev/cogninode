// src/hooks/useModalStack.ts
// Shared bookkeeping for stacked modals so they behave like one system:
//
//   · Escape closes only the TOPMOST modal — one press unwinds one layer,
//     never two at once (previously Settings + QuickJump both closed).
//   · Focus returns to the element that opened a modal when it closes.
//   · Tab / Shift+Tab wrap inside the modal instead of escaping to the page.
//   · `anyModalOpen()` lets global shortcuts (⌃N, Esc-cancels-stream, the
//     overlay toggles) stand down while something modal is on screen.
//
// The z-scale and this stack must agree. Canonical order, low → high:
//   SelectionPopup 100 < TreeMap 150 < QuickJump / Shortcuts / dialogs 200
//   < SettingsModal 210 < toasts 300.

import { useEffect, useRef, type RefObject } from "react";

let stack: symbol[] = [];

/** True while any registered modal/overlay is open. */
export function anyModalOpen(): boolean {
  return stack.length > 0;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), ' +
  'textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Register a modal while `active` is true. Pass the dialog's root element
 * ref to also get the Tab-wrap focus trap; omit it to get just Esc-to-close
 * and focus restore.
 */
export function useModalBehavior(
  active: boolean,
  onClose: () => void,
  containerRef?: RefObject<HTMLElement | null>,
): void {
  // Keep the latest onClose without re-registering (and re-stacking) the
  // modal every time the consumer recreates the callback.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return undefined;

    const id = Symbol("modal");
    stack.push(id);
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKey = (e: KeyboardEvent): void => {
      if (stack.at(-1) !== id) return;   // only the top modal reacts
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && containerRef?.current) {
        const els = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (els.length === 0) return;
        const first = els[0]!;
        const last  = els[els.length - 1]!;
        const current = document.activeElement;
        if (!e.shiftKey && current === last) {
          e.preventDefault();
          first.focus();
        } else if (
          e.shiftKey &&
          (current === first || !containerRef.current.contains(current))
        ) {
          e.preventDefault();
          last.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      stack = stack.filter(s => s !== id);
      window.removeEventListener("keydown", onKey);
      // Hand focus back to whatever opened the modal, if it still exists.
      if (opener && opener.isConnected) opener.focus();
    };
  }, [active, containerRef]);
}
