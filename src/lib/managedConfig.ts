// src/lib/managedConfig.ts
// Decides which mode the app boots in. MANAGED mode (Clerk sign-in, Convex
// backend, per-user OpenRouter key + credits) switches on only when both env
// vars are present at build time — without them the app runs as the
// original local-first build: BYOK key in localStorage, no network deps
// beyond OpenRouter, no backend code on any runtime path. (Not bit-for-bit:
// request attribution headers, the usage-accounting body param, and a few
// optional persisted message fields are shared with managed mode.) That
// keeps self-hosting and the Playwright smokes working with zero config.
//
// Test seam: setting localStorage "cogninode_force_local" = "1" (e.g. via
// Playwright addInitScript) forces local mode even when the env is
// configured. Read once at module init — mode never changes mid-session.

export interface ManagedConfig {
  convexUrl: string;
  clerkPublishableKey: string;
}

let cached: ManagedConfig | null | undefined;

function compute(): ManagedConfig | null {
  try {
    if (localStorage.getItem("cogninode_force_local") === "1") return null;
  } catch { /* ignore */ }
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
  const clerkPublishableKey =
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  if (!convexUrl || !clerkPublishableKey) return null;
  return { convexUrl, clerkPublishableKey };
}

export function getManagedConfig(): ManagedConfig | null {
  if (cached === undefined) cached = compute();
  return cached;
}

export function isManagedMode(): boolean {
  return getManagedConfig() !== null;
}
