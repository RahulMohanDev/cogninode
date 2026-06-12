// src/components/credits/BalancePill.tsx
// Live credit balance in the composer footer. Only renders when the next
// send would actually spend credits (managed mode, no BYOK key). Click
// opens the top-up sheet.

import { useCredits } from "../../hooks/useCredits";
import { useSettings } from "../../hooks/useSettings";
import { formatCredits } from "../../lib/credits";

export function BalancePill() {
  const { managed, balance, openTopUp } = useCredits();
  const { keySource } = useSettings();
  if (!managed || keySource !== "managed" || balance === null) return null;

  const tone =
    balance <= 0
      ? "tw:bg-coral-tint tw:text-coral"
      : balance < 300
        ? "tw:bg-butter-tint tw:text-[#8a5a0a] tw:dark:text-butter"
        : "tw:bg-teal-tint tw:text-teal";

  return (
    <button
      type="button"
      className={`tw:font-mono tw:text-[11px] tw:font-medium tw:tracking-[0.04em] tw:py-[3px] tw:px-[9px] tw:rounded-[999px] tw:transition-[background-color,color] tw:duration-200 tw:ease-[ease] tw:cursor-pointer ${tone}`}
      onClick={openTopUp}
      title="Your credit balance — top up"
    >
      {formatCredits(Math.max(0, balance))}
    </button>
  );
}

export default BalancePill;
