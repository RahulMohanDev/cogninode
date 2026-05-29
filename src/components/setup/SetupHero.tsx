// src/components/setup/SetupHero.tsx
// Left-hand "flavour" panel of the setup screen: branding, tagline, and the
// short list of feature notes. Presentational only — no state, no props.

import { Glyph } from "../Glyph";

const NOTES = [
    { color: "var(--coral)", text: "Every chat is a tree of branched thoughts." },
    { color: "var(--teal)", text: "Switch models mid-conversation, see cost per message." },
    { color: "var(--lilac)", text: "Reflect any thread into a clean note." },
];

export function SetupHero() {
    return (
        <div className="auth-side">
            <a
                href="https://github.com/RahulMohanDev/cogninode"
                target="_blank"
                rel="noopener noreferrer"
                className="auth-brand"
            >
                <Glyph size={22} />
                <span>
                    cogninode <span className="beta-tag">beta</span>
                </span>
            </a>

            <div className="auth-quote">
                Think with AI,<br />
                <em>not</em> at it.
            </div>
            <p className="auth-byline">
                Open source. Runs locally. Uses your own OpenRouter key —
                stored in this browser, never sent anywhere except OpenRouter.
            </p>

            <div className="auth-byline gate-notes">
                {NOTES.map((n) => (
                    <div className="gate-note" key={n.text}>
                        <span className="gate-note-dot" style={{ background: n.color }} />
                        <span>{n.text}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default SetupHero;
