// src/hooks/useApiKeyValidation.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { OpenRouterError } from "@openrouter/sdk/models/errors";
import { useApiKeyValidation } from "./useApiKeyValidation";

// Mock only the client — keep the REAL OpenRouterError so the hook's
// `instanceof` checks behave like production.
const { getCurrentKeyMetadata, OpenRouterCtor } = vi.hoisted(() => {
    const getCurrentKeyMetadata = vi.fn();
    // Must be a regular function, not an arrow: the hook calls `new OpenRouter()`
    // and arrows can't be construct-called. Returning an object from a
    // construct-called function makes `new` yield that object.
    const OpenRouterCtor = vi.fn(function () {
        return { apiKeys: { getCurrentKeyMetadata } };
    });
    return { getCurrentKeyMetadata, OpenRouterCtor };
});

vi.mock("@openrouter/sdk", () => ({ OpenRouter: OpenRouterCtor }));

/** Build a real OpenRouterError carrying a given HTTP status, the way the
 *  SDK would throw one (statusCode is read off response.status). */
function httpError(status: number): OpenRouterError {
    return new OpenRouterError(`HTTP ${status}`, {
        response: new Response(null, { status }),
        request: new Request("https://openrouter.ai/api/v1/key"),
        body: "",
    });
}

beforeEach(() => {
    // Clear the constructor's call history but KEEP its implementation
    // (mockReset would wipe it). Reset the metadata mock fully so any
    // queued *Once values from a prior test don't leak, then set the
    // default "valid key" resolution.
    OpenRouterCtor.mockClear();
    getCurrentKeyMetadata.mockReset();
    getCurrentKeyMetadata.mockResolvedValue({ data: {} });
});

describe("useApiKeyValidation", () => {
    it("rejects an empty/whitespace key without calling the SDK", async () => {
        const { result } = renderHook(() => useApiKeyValidation());

        let returned: string | null = "unset";
        await act(async () => {
            returned = await result.current.validate("   ");
        });

        expect(returned).toBeNull();
        expect(result.current.error).toBe("Paste your OpenRouter key to continue.");
        expect(OpenRouterCtor).not.toHaveBeenCalled();
        expect(getCurrentKeyMetadata).not.toHaveBeenCalled();
    });

    it("returns the trimmed key and constructs the client with it on success", async () => {
        const { result } = renderHook(() => useApiKeyValidation());

        let returned: string | null = null;
        await act(async () => {
            returned = await result.current.validate("  sk-or-v1-good  ");
        });

        expect(returned).toBe("sk-or-v1-good");
        expect(OpenRouterCtor).toHaveBeenCalledWith({ apiKey: "sk-or-v1-good" });
        expect(getCurrentKeyMetadata).toHaveBeenCalledTimes(1);
        expect(result.current.error).toBeNull();
        expect(result.current.verifying).toBe(false);
    });

    it("maps a 401 to the bad-key message", async () => {
        getCurrentKeyMetadata.mockRejectedValueOnce(httpError(401));
        const { result } = renderHook(() => useApiKeyValidation());

        let returned: string | null = "unset";
        await act(async () => {
            returned = await result.current.validate("sk-bad");
        });

        expect(returned).toBeNull();
        expect(result.current.error).toBe("Key didn't work — check it and try again.");
    });

    it("maps a 403 to the bad-key message too", async () => {
        getCurrentKeyMetadata.mockRejectedValueOnce(httpError(403));
        const { result } = renderHook(() => useApiKeyValidation());

        await act(async () => {
            await result.current.validate("sk-forbidden");
        });

        expect(result.current.error).toBe("Key didn't work — check it and try again.");
    });

    it("surfaces the HTTP status for other OpenRouter errors", async () => {
        getCurrentKeyMetadata.mockRejectedValueOnce(httpError(500));
        const { result } = renderHook(() => useApiKeyValidation());

        let returned: string | null = "unset";
        await act(async () => {
            returned = await result.current.validate("sk-or-v1-good");
        });

        expect(returned).toBeNull();
        expect(result.current.error).toBe(
            "OpenRouter rejected the request (HTTP 500). Try again.",
        );
    });

    it("treats a non-HTTP throw as a connectivity failure", async () => {
        getCurrentKeyMetadata.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        const { result } = renderHook(() => useApiKeyValidation());

        await act(async () => {
            await result.current.validate("sk-or-v1-good");
        });

        expect(result.current.error).toBe(
            "Couldn't reach OpenRouter. Check your connection and try again.",
        );
    });

    it("clearError() resets a previous error", async () => {
        getCurrentKeyMetadata.mockRejectedValueOnce(httpError(401));
        const { result } = renderHook(() => useApiKeyValidation());

        await act(async () => {
            await result.current.validate("sk-bad");
        });
        expect(result.current.error).not.toBeNull();

        act(() => {
            result.current.clearError();
        });
        expect(result.current.error).toBeNull();
    });

    it("toggles verifying around an in-flight validation", async () => {
        let resolveCall: (v: unknown) => void = () => {};
        getCurrentKeyMetadata.mockReturnValueOnce(
            new Promise((res) => { resolveCall = res; }),
        );
        const { result } = renderHook(() => useApiKeyValidation());

        let pending: Promise<string | null>;
        act(() => {
            pending = result.current.validate("sk-or-v1-good");
        });
        // Mid-flight: verifying should be true.
        expect(result.current.verifying).toBe(true);

        await act(async () => {
            resolveCall({ data: {} });
            await pending;
        });
        expect(result.current.verifying).toBe(false);
    });
});
