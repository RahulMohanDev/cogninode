// src/components/credits/TopUpModal.tsx
// The credits top-up sheet. Buy → Convex createOrder → Razorpay checkout →
// confirmCheckout (signature-verified, instant) with the payment.captured
// webhook as the closed-tab fallback. The balance line updates by itself:
// CreditsProvider's Convex subscription delivers the new balance the moment
// either path applies the purchase — no polling.
//
// Deliberately hook-free of Clerk/Convex (it mounts in local mode too,
// closed): server calls go through the module-level convex client.

import { useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "../../lib/convexClient";
import { useModalBehavior } from "../../hooks/useModalStack";
import { formatCredits } from "../../lib/credits";
import { openCheckout } from "../../lib/razorpay";

export interface TopUpModalProps {
  open:    boolean;
  onClose: () => void;
  balance: number | null;
}

type BuyState =
  | { step: "idle" }
  | { step: "ordering" }
  | { step: "checkout" }
  | { step: "confirming" }
  | { step: "done"; credits: number }
  | { step: "error"; message: string };

export function TopUpModal({ open, onClose, balance }: TopUpModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalBehavior(open, onClose, panelRef);
  const [buy, setBuy] = useState<BuyState>({ step: "idle" });

  if (!open) return null;

  const busy = buy.step === "ordering" || buy.step === "checkout" || buy.step === "confirming";

  const startBuy = async (): Promise<void> => {
    const client = getConvexClient();
    if (!client) return;
    setBuy({ step: "ordering" });
    try {
      const order = await client.action(api.payments.createOrder, {});
      setBuy({ step: "checkout" });
      await openCheckout({
        keyId: order.keyId,
        orderId: order.orderId,
        amountPaise: order.amountPaise,
        currency: order.currency,
        onSuccess: (r) => {
          setBuy({ step: "confirming" });
          void client
            .action(api.payments.confirmCheckout, {
              razorpayOrderId: r.razorpayOrderId,
              razorpayPaymentId: r.razorpayPaymentId,
              signature: r.signature,
            })
            .then(() => setBuy({ step: "done", credits: order.credits }))
            .catch(() => {
              // The webhook path will still apply it — tell the user to
              // wait rather than scaring them into paying twice.
              setBuy({
                step: "error",
                message:
                  "Payment received — confirmation is taking a moment. " +
                  "Your credits will appear automatically; UPI can take a " +
                  "few minutes. Don't pay again.",
              });
            });
        },
        onDismiss: () => setBuy({ step: "idle" }),
      });
    } catch (err) {
      setBuy({
        step: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

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
          {buy.step === "done"
            ? "Credits added"
            : balance !== null && balance <= 0
              ? "You're out of credits"
              : "Top up credits"}
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
            className="tw:bg-coral tw:text-bg tw:py-2.5 tw:px-5 tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:hover:bg-[#ff4520] tw:disabled:bg-ink-4 tw:disabled:cursor-not-allowed"
            disabled={busy || buy.step === "done"}
            onClick={() => void startBuy()}
          >
            {buy.step === "ordering" ? "Preparing…"
              : buy.step === "checkout" ? "Waiting…"
              : buy.step === "confirming" ? "Confirming…"
              : buy.step === "done" ? "Done ✓"
              : "Buy"}
          </button>
        </div>

        {buy.step === "done" && (
          <p className="tw:m-0 tw:text-teal tw:text-[13px]">
            {formatCredits(buy.credits)} added. Happy thinking!
          </p>
        )}
        {buy.step === "error" && (
          <p role="alert" className="tw:m-0 tw:text-coral tw:text-[13px]">{buy.message}</p>
        )}
        {buy.step === "confirming" && (
          <p className="tw:m-0 tw:text-ink-3 tw:text-[12px]">
            Confirming your payment — UPI can take a few minutes. Credits
            appear automatically.
          </p>
        )}
        {buy.step === "idle" && (
          <p className="tw:m-0 tw:text-ink-3 tw:text-[12px]">
            Pay by UPI, card, or netbanking via Razorpay. Prefer your own
            OpenRouter key? Add it in Settings — those chats skip credits
            entirely.
          </p>
        )}
      </div>
    </div>
  );
}

export default TopUpModal;
