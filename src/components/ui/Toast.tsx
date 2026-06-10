// src/components/ui/Toast.tsx
// App-wide toast notifications. Mount <ToastProvider> once near the root;
// fire from anywhere below it with:
//
//   const toast = useToast();
//   toast("Reflection saved", { kind: "success" });
//
// Toasts stack bottom-right above every overlay (z-300 — see the z-scale
// note in useModalStack.ts), auto-dismiss (errors linger longer), dismiss
// on click, and announce politely to screen readers.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ToastKind = "success" | "error" | "info";

export type ToastFn = (
  message: string,
  opts?: { kind?: ToastKind; durationMs?: number },
) => void;

interface ToastItem {
  id:      number;
  message: string;
  kind:    ToastKind;
}

const ToastContext = createContext<ToastFn | null>(null);

const KIND_DOT: Record<ToastKind, string> = {
  success: "tw:bg-teal",
  error:   "tw:bg-coral",
  info:    "tw:bg-lilac",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts(prev => prev.filter(x => x.id !== id));
  }, []);

  const toast = useCallback<ToastFn>((message, opts) => {
    const id   = nextId.current++;
    const kind = opts?.kind ?? "info";
    const durationMs = opts?.durationMs ?? (kind === "error" ? 6000 : 3500);
    // Keep at most 4 on screen — oldest rolls off when a fifth arrives.
    setToasts(prev => [...prev.slice(-3), { id, message, kind }]);
    timers.current.set(id, window.setTimeout(() => dismiss(id), durationMs));
  }, [dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) window.clearTimeout(t);
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div className="tw:fixed tw:bottom-5 tw:right-5 tw:z-[300] tw:flex tw:flex-col tw:items-end tw:gap-2 tw:pointer-events-none">
          {toasts.map(t => (
            <div
              key={t.id}
              role="status"
              aria-live="polite"
              className="tw:pointer-events-auto tw:flex tw:items-center tw:gap-2.5 tw:bg-ink tw:text-bg tw:py-2.5 tw:px-3.5 tw:rounded-[10px] tw:text-[13px] tw:max-w-[360px] tw:shadow-[0_16px_40px_-14px_rgba(0,0,0,0.4)] tw:cursor-pointer tw:animate-[popUp_0.18s_cubic-bezier(0.34,1.56,0.64,1)]"
              onClick={() => dismiss(t.id)}
              title="Dismiss"
            >
              <span className={`tw:w-2 tw:h-2 tw:rounded-[50%] tw:flex-none ${KIND_DOT[t.kind]}`} />
              <span className="tw:min-w-0">{t.message}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
