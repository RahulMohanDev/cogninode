// src/components/setup/ApiKeyForm.tsx
// Right-hand panel of the setup screen: the key input and everything around
// it. Owns the draft field; defers the actual validation to
// useApiKeyValidation and persists the key via useSettings on success.

import { useState, type FormEvent } from "react";
import { useSettings } from "../../hooks/useSettings";
import { useApiKeyValidation } from "../../hooks/useApiKeyValidation";

export function ApiKeyForm() {
    const { setApiKey } = useSettings();
    const { verifying, error, validate, clearError } = useApiKeyValidation();
    const [draft, setDraft] = useState("");

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const validKey = await validate(draft);
        if (validKey) setApiKey(validKey);
    }

    return (
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
                                if (error) clearError();
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
                        href="https://github.com/RahulMohanDev/cogninode"
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
    );
}

export default ApiKeyForm;
