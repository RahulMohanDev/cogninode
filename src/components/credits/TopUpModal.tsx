// src/components/credits/TopUpModal.tsx
// The credits top-up sheet. Phase B ships it as the out-of-credits landing
// spot with the pack on display; Phase C wires the buy button to Razorpay.
// Modal-stack registered at z-210 (same layer as Settings).

import { useRef } from "react";
import { useModalBehavior } from "../../hooks/useModalStack";
import { formatCredits } from "../../lib/credits";

export interface TopUpModalProps {
  open:    boolean;
  onClose: () => void;
  balance: number | null;
}

export function TopUpModal({ open, onClose, balance }: TopUpModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalBehavior(open, onClose, panelRef);

  if (!open) return null;

  return (
    <div
      className="tw:fixed tw:inset-0 tw:bg-[color-mix(in_oklab,var(--ink)_30%,transparent)] tw:dark:bg-[var(--veil-black-60)] tw:backdrop-blur-[8px] tw:grid tw:place-items-center tw:z-[210] tw:animate-[fadeIn_0.14s_ease-out]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Top up credits"
        className="tw:w-[min(420px,92vw)] tw:bg-bg-3 tw:border tw:border-line tw:rounded-app tw:shadow-3 tw:p-6 tw:animate-[popUp_0.18s_cubic-bezier(0.34,1.56,0.64,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="tw:m-0 tw:mb-1 tw:font-display tw:font-semibold tw:text-[20px] tw:tracking-[-0.015em]">
          {balance !== null && balance <= 0 ? "You're out of credits" : "Top up credits"}
        </h2>
        <p className="tw:m-0 tw:mb-4 tw:text-ink-2 tw:text-[14px]">
          {balance !== null
            ? <>Current balance: <strong>{formatCredits(Math.max(0, balance))}</strong>.</>
            : "Credits pay for your chats."}{" "}
          One credit covers a quick question on a fast model; deep
          thinking-model answers use more.
        </p>

        <div className="tw:border tw:border-line tw:rounded-app-sm tw:p-4 tw:mb-4 tw:flex tw:items-center tw:justify-between tw:gap-3">
          <div>
            <div className="tw:font-display tw:font-semibold tw:text-[18px]">₹300</div>
            <div className="tw:text-ink-3 tw:text-[13px]">3,000 credits · never expire</div>
          </div>
          <button
            className="tw:bg-coral tw:text-bg tw:py-2.5 tw:px-5 tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:disabled:bg-ink-4 tw:disabled:cursor-not-allowed"
            disabled
            title="Payments are launching soon"
          >
            Buy
          </button>
        </div>

        <p className="tw:m-0 tw:text-ink-3 tw:text-[12px]">
          Payments are launching soon. Until then you can keep chatting by
          adding your own OpenRouter key in Settings.
        </p>
      </div>
    </div>
  );
}

export default TopUpModal;
