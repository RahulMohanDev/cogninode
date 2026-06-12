// src/hooks/useCredits.tsx
// App-wide credit state for managed mode. The context is mounted in BOTH
// modes (so consumers like Composer never branch their hooks); in local
// mode it's inert ({ managed: false, balance: null }). The Convex
// subscription lives in a bridge child that only mounts under managed mode
// — same pattern as AuthGate pushing the managed key into settings.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { isManagedMode } from "../lib/managedConfig";
import { TopUpModal } from "../components/credits/TopUpModal";

export interface CreditsContextValue {
  /** True when the app runs in managed (Clerk+Convex) mode. */
  managed: boolean;
  /** Live credit balance; null while loading, signed out, or in local mode.
   *  Can go negative (charging happens post-stream) — the composer blocks
   *  the next send. */
  balance: number | null;
  openTopUp: () => void;
}

const CreditsContext = createContext<CreditsContextValue>({
  managed: false,
  balance: null,
  openTopUp: () => {},
});

export function CreditsProvider({ children }: { children: ReactNode }) {
  const managed = isManagedMode();
  const [balance, setBalance] = useState<number | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const openTopUp = useCallback(() => setTopUpOpen(true), []);

  const value = useMemo<CreditsContextValue>(
    () => ({ managed, balance, openTopUp }),
    [managed, balance, openTopUp],
  );

  return (
    <CreditsContext.Provider value={value}>
      {children}
      {managed && <BalanceBridge onBalance={setBalance} />}
      <TopUpModal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        balance={balance}
      />
    </CreditsContext.Provider>
  );
}

function BalanceBridge({ onBalance }: { onBalance: (b: number | null) => void }) {
  // Returns null while loading and for signed-out callers — both map to
  // "unknown" and the UI simply hides credit affordances.
  const balance = useQuery(api.credits.balance);
  useEffect(() => {
    onBalance(typeof balance === "number" ? balance : null);
  }, [balance, onBalance]);
  return null;
}

export function useCredits(): CreditsContextValue {
  return useContext(CreditsContext);
}
