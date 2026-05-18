// src/components/setup/ApiKeyGate.tsx
// Wraps the app: if no OpenRouter key is stored, shows the setup screen
// from design/app-beta/setup.html. On submit, verifies the key against
// OpenRouter's /api/v1/models endpoint before persisting it.

import { useState, type FormEvent, type ReactNode } from "react";
import { useSettings } from "../../hooks/useSettings";
import { Glyph } from "../Glyph";

export interface ApiKeyGateProps {
  children: ReactNode;
}

const NOTES = [
  { color: "var(--coral)", text: "Every chat is a tree of branched thoughts." },
  { color: "var(--teal)",  text: "Switch models mid-conversation, see cost per message." },
  { color: "var(--lilac)", text: "Reflect any thread into a clean note." },
];

export function ApiKeyGate({ children }: ApiKeyGateProps) {
  const { apiKey, setApiKey } = useSettings();
  const [draft, setDraft]         = useState("");
  const [error, setError]         = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  if (apiKey) return <>{children}</>;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Paste your OpenRouter key to continue.");
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!res.ok) {
        setError("Key didn't work — check it and try again.");
        return;
      }
      setApiKey(trimmed);
    } catch {
      setError("Couldn't reach OpenRouter. Check your connection and try again.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="auth-page key-gate">
      <div className="auth-side">
        <a
          href="https://github.com/rahulmohan/cogninode"
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

      <div className="auth-form">
        <div className="auth-wrap">
          <h1>
            Connect your <em>key.</em>
          </h1>
          <p className="lead">
            Paste your OpenRouter API key below. It's stored only in this
            browser's localStorage — never sent anywhere except OpenRouter.
          </p>

          <form onSubmit={submit}>
            <div className="field">
              <label>OpenRouter API key</label>
              <input
                type="password"
                placeholder="sk-or-v1-..."
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (error) setError(null);
                }}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                style={{ fontFamily: "var(--mono)", fontSize: 14 }}
                required
              />
            </div>

            {error && (
              <div className="gate-error">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M8 5 V9 M8 11 V11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                {error}
              </div>
            )}

            <button className="btn-primary coral" type="submit" disabled={verifying}>
              {verifying ? "Verifying…" : (
                <>
                  Connect
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M3 8 H13 M9 4 L13 8 L9 12"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </>
              )}
            </button>
          </form>

          <div className="tos gate-tos">
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              style={{ verticalAlign: "-1px", marginRight: 4 }}
            >
              <rect x="3" y="7" width="10" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            Stored locally · never leaves your browser ·{" "}
            <a
              href="https://github.com/rahulmohan/cogninode"
              target="_blank"
              rel="noopener noreferrer"
            >
              open source
            </a>
          </div>

          <div className="foot-link">
            Don't have a key? Get one at{" "}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
              openrouter.ai/keys
              <svg
                width="11"
                height="11"
                viewBox="0 0 16 16"
                fill="none"
                style={{ verticalAlign: "-1px", marginLeft: 2 }}
              >
                <path
                  d="M5 11 L11 5 M6 5 H11 V10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ApiKeyGate;
