// src/components/setup/SetupHero.tsx
// Left-hand "flavour" panel of the setup screen: branding, tagline, and the
// short list of feature notes. Presentational only — no state, no props.
// Hidden ≤880px (the form becomes the whole gate).

import { Glyph } from "../Glyph";

const NOTES = [
    { color: "var(--coral)", text: "Every chat is a tree of branched thoughts." },
    { color: "var(--teal)", text: "Switch models mid-conversation, see cost per message." },
    { color: "var(--lilac)", text: "Reflect any thread into a clean note." },
];

export function SetupHero() {
    return (
        <div className="tw:bg-bg tw:relative tw:flex tw:flex-col tw:px-12 tw:py-9 tw:overflow-hidden tw:max-[880px]:hidden">
            <a
                href="https://github.com/RahulMohanDev/cogninode"
                target="_blank"
                rel="noopener noreferrer"
                className="tw:flex tw:items-center tw:gap-2.5 tw:font-display tw:font-semibold tw:text-[20px] tw:tracking-[-0.02em]"
            >
                <Glyph size={22} />
                <span>
                    cogninode <span className="beta-tag">beta</span>
                </span>
            </a>

            <div className="tw:mt-auto tw:font-display tw:text-[38px] tw:leading-none tw:tracking-[-0.025em] tw:font-semibold tw:text-balance tw:max-w-[460px]">
                Think with AI,<br />
                <em className="tw:font-serif tw:italic tw:text-coral tw:font-normal">not</em> at it.
            </div>
            {/* bottom margin stays the UA-default 1em (from the compat base
                layer) — the gate-notes block below spaces against it */}
            <p className="tw:mt-4 tw:text-ink-3 tw:text-[14px] tw:max-w-[420px]">
                Open source. Runs locally. Uses your own OpenRouter key —
                stored in this browser, never sent anywhere except OpenRouter.
            </p>

            <div className="tw:mt-7 tw:text-ink-3 tw:text-[14px] tw:max-w-[420px] tw:flex tw:flex-col tw:gap-2.5">
                {NOTES.map((n) => (
                    <div className="tw:flex tw:items-center tw:gap-2.5 tw:text-[13px] tw:text-ink-2" key={n.text}>
                        <span className="tw:w-[7px] tw:h-[7px] tw:rounded-[50%] tw:flex-none" style={{ background: n.color }} />
                        <span>{n.text}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default SetupHero;
