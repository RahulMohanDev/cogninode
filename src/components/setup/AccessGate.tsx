// src/components/setup/AccessGate.tsx
// Picks the gate for the boot mode (decided once at module init, see
// lib/managedConfig.ts): managed → Clerk sign-in via AuthGate; local →
// the original BYOK ApiKeyGate. The mode never changes mid-session, so the
// branch is stable and each gate's hooks run under the providers they need.

import { type ReactNode } from "react";
import { isManagedMode } from "../../lib/managedConfig";
import { ApiKeyGate } from "./ApiKeyGate";
import { AuthGate } from "./AuthGate";

export function AccessGate({ children }: { children: ReactNode }) {
  return isManagedMode()
    ? <AuthGate>{children}</AuthGate>
    : <ApiKeyGate>{children}</ApiKeyGate>;
}

export default AccessGate;
