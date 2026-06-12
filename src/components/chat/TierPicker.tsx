// src/components/chat/TierPicker.tsx
// Simple-mode model picker: two or three large tier rows (Fast / Thinking)
// with a "~N credits / message" figure, plus an "All models" escape hatch
// into the full advanced picker. Pure presentation — selection state and
// the popover open/close live in the Composer like the advanced picker's.

import { estimateCreditsPerMessage } from "../../lib/credits";
import type { Tier } from "../../hooks/useTiers";

const TIER_DOT: Record<string, string> = {
  fast:     "var(--teal)",
  thinking: "var(--lilac)",
};

export function tierDotColor(key: string): string {
  return TIER_DOT[key] ?? "var(--coral)";
}

export interface TierPickerProps {
  tiers:          Tier[];
  selectedKey:    string;
  onSelect:       (key: string) => void;
  onShowAllModels: () => void;
}

export function TierPicker({ tiers, selectedKey, onSelect, onShowAllModels }: TierPickerProps) {
  return (
    <div
      className="tw:absolute tw:bottom-[calc(100%+6px)] tw:left-0 tw:w-[300px] tw:bg-bg-3 tw:border tw:border-line tw:rounded-[12px] tw:shadow-3 tw:z-30 tw:overflow-hidden tw:animate-[popUp_0.15s_cubic-bezier(0.34,1.56,0.64,1)]"
    >
      <div className="tw:p-1.5">
        {tiers.map((t) => {
          const credits = estimateCreditsPerMessage(t.promptPerM, t.completionPerM);
          const selected = t.key === selectedKey;
          return (
            <div
              key={t.key}
              className={`tw:flex tw:items-center tw:gap-3 tw:py-2.5 tw:px-3 tw:rounded-[8px] tw:cursor-pointer ${selected ? "tw:bg-butter-tint tw:dark:bg-[color-mix(in_oklab,var(--butter)_14%,transparent)]" : "tw:hover:bg-bg-2"}`}
              onClick={() => onSelect(t.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t.key); } }}
            >
              <span
                className="tw:w-[9px] tw:h-[9px] tw:rounded-[50%] tw:flex-none"
                style={{ background: tierDotColor(t.key) }}
              />
              <div className="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-px">
                <span className="tw:font-medium tw:text-[14px] tw:text-ink">{t.displayName}</span>
                <span className="tw:text-[12px] tw:text-ink-3">{t.blurb}</span>
              </div>
              <span className="tw:font-mono tw:text-[10px] tw:text-ink-2 tw:bg-bg-2 tw:py-0.5 tw:px-[7px] tw:rounded-[999px] tw:flex-none" title="approximate credits per message — the exact amount shows under each reply">
                ~{credits} cr
              </span>
            </div>
          );
        })}
      </div>
      <div
        className="tw:flex tw:items-center tw:gap-2 tw:py-2 tw:px-3 tw:text-[12px] tw:cursor-pointer tw:text-ink-3 tw:border-t tw:border-line tw:hover:text-ink tw:hover:bg-bg-2"
        onClick={onShowAllModels}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onShowAllModels(); } }}
      >
        <span>All models</span>
        <svg className="tw:ml-auto" width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path d="M3 8 H13 M9 4 L13 8 L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

export default TierPicker;
