// src/hooks/useApiKeyValidation.ts
// Validates an OpenRouter API key with the official @openrouter/sdk before
// the app trusts it. We call apiKeys.getCurrentKeyMetadata() (GET /api/v1/key),
// an authenticated round-trip that throws UnauthorizedResponseError (401) for
// a bad key — unlike GET /api/v1/models, a public endpoint that returns 200
// regardless of the Authorization header and so can't tell a valid key from a
// typo. (Key info is distinct from the OAuth code-exchange flow under /auth.)

import { useCallback, useState } from "react";
import { OpenRouter } from "@openrouter/sdk";
import { OpenRouterError } from "@openrouter/sdk/models/errors";

export interface UseApiKeyValidation {
    /** True while a validation round-trip is in flight. */
    verifying: boolean;
    /** Human-readable failure from the last validate(), or null. */
    error: string | null;
    /** Clear the current error (e.g. when the user edits the field). */
    clearError: () => void;
    /** Validate a raw key. Resolves to the trimmed key when it's usable,
     *  or null when it isn't (with `error` set to explain why). */
    validate: (rawKey: string) => Promise<string | null>;
}

export function useApiKeyValidation(): UseApiKeyValidation {
    const [error, setError] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);

    const clearError = useCallback(() => setError(null), []);

    const validate = useCallback(async (rawKey: string): Promise<string | null> => {
        const trimmed = rawKey.trim();
        if (!trimmed) {
            setError("Paste your OpenRouter key to continue.");
            return null;
        }
        setError(null);
        setVerifying(true);
        try {
            const client = new OpenRouter({ apiKey: trimmed });
            // Authenticated round-trip: succeeds only for a usable key, throws
            // UnauthorizedResponseError (a 401 OpenRouterError) for a bad one.
            await client.apiKeys.getCurrentKeyMetadata();
            return trimmed;
        } catch (err) {
            if (err instanceof OpenRouterError) {
                // We reached OpenRouter and it rejected the request. 401/403
                // means the key is bad; any other status is a server hiccup.
                setError(
                    err.statusCode === 401 || err.statusCode === 403
                        ? "Key didn't work — check it and try again."
                        : `OpenRouter rejected the request (HTTP ${err.statusCode}). Try again.`,
                );
            } else {
                // Never reached OpenRouter — offline, DNS, CORS preflight, etc.
                setError("Couldn't reach OpenRouter. Check your connection and try again.");
            }
            return null;
        } finally {
            setVerifying(false);
        }
    }, []);

    return { verifying, error, validate, clearError };
}
