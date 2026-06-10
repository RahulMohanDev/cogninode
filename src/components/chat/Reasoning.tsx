// Collapsible "Thinking" panel for reasoning-model output (DeepSeek R1,
// Tencent HY3, OpenAI o1-style, etc). Auto-expands while the stream is
// active so the user sees the chain-of-thought arrive; collapses by
// default once the answer lands.
//
// Spinning four-pointed star icon (CSS-rotated) plays while `streaming`
// is true — same visual language as OpenAI's "Thinking…" affordance.

import { useState, useEffect } from "react";
import { MarkdownBody } from "./MarkdownBody";

export interface ReasoningProps {
  text:       string;
  streaming?: boolean;
}

export function Reasoning({ text, streaming = false }: ReasoningProps) {
  // Open while actively streaming so the user watches the model think.
  // Collapse once the answer arrives — but remember any manual override
  // (if the user closed it mid-stream, respect that).
  const [open, setOpen]       = useState(streaming);
  const [touched, setTouched] = useState(false);

  // Auto-expand when streaming starts; auto-collapse when streaming ends
  // (unless the user has manually toggled the panel in the meantime).
  useEffect(() => {
    if (touched) return;
    setOpen(streaming);
  }, [streaming, touched]);

  if (!text && !streaming) return null;

  const toggle = (): void => {
    setTouched(true);
    setOpen(v => !v);
  };

  return (
    <div className={`tw:flex tw:flex-col tw:mt-0 tw:mx-0 tw:mb-2.5 tw:border tw:rounded-app-sm tw:bg-[color-mix(in_oklab,var(--bg-2)_60%,transparent)] tw:overflow-hidden ${streaming ? "tw:border-[color-mix(in_oklab,var(--lilac)_50%,var(--line))]" : "tw:border-line"}`}>
      <button type="button" className={`tw:flex tw:items-center tw:gap-2 tw:py-2 tw:px-3 tw:font-mono tw:text-[11px] tw:uppercase tw:tracking-[0.08em] tw:bg-transparent tw:border-none tw:cursor-pointer tw:text-left tw:w-full tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-[color-mix(in_oklab,var(--lilac)_6%,transparent)] ${streaming ? "tw:text-ink" : "tw:text-ink-3 tw:hover:text-ink-2"}`} onClick={toggle} aria-expanded={open}>
        <ThinkingStar spinning={streaming} />
        <span className={`tw:flex-1 tw:min-w-0 ${streaming ? "tw:after:content-[''] tw:after:inline-block tw:after:w-1 tw:after:ml-0.5" : ""}`}>
          {streaming ? "Thinking…" : "Thought"}
        </span>
        <svg className={`tw:text-ink-3 tw:transition-transform tw:duration-[180ms] tw:ease-[ease] tw:flex-none ${open ? "tw:[transform:rotate(180deg)]" : ""}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.4"
                strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="rs-body tw:pt-1 tw:px-3.5 tw:pb-3 tw:text-[13.5px] tw:text-ink-2 tw:border-t tw:border-t-[color-mix(in_oklab,var(--line)_60%,transparent)] tw:bg-[color-mix(in_oklab,var(--bg-2)_80%,transparent)]">
          {text
            ? <MarkdownBody text={text} />
            : <span className="tw:text-ink-3 tw:italic tw:text-[12px]">(no thoughts yet)</span>}
        </div>
      )}
    </div>
  );
}

function ThinkingStar({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={`rs-star${spinning ? " spin" : ""}`}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      {/* Four-pointed sparkle: long N/S/E/W spokes with shorter diagonals.
          Rotates via the .spin class in app.css. */}
      <path
        d="M8 0.5
           L8.9 6.4
           L15.5 8
           L8.9 9.6
           L8 15.5
           L7.1 9.6
           L0.5 8
           L7.1 6.4 Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default Reasoning;
