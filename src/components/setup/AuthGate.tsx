// src/components/setup/AuthGate.tsx
// Managed-mode gate: Clerk sign-in wall → account/key bootstrap → app.
// Mirrors ApiKeyGate's contract (inside the gate a usable apiKey exists in
// SettingsContext) but the key is the server-provisioned per-user OpenRouter
// key, pushed into settings once the backend reports it active.
//
// Bootstrap states, in order:
//   1. Clerk auth loading            → boot screen
//   2. signed out                    → SetupHero + <SignIn/>
//   3. user row missing              → call users.ensure once, boot screen
//   4. keyStatus "provisioning"      → boot screen
//   5. keyStatus "error"             → retry panel (ensure() again)
//   6. local data owned by another account → blocking choice dialog
//   7. key active                    → push into settings, render the app
//
// StrictMode double-mounts effects — the ensure() call is promise-guarded
// (idempotent server-side too), and the account-link check is a one-shot
// reconcile keyed on the Clerk user id.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import { SignIn, useClerk, useUser } from "@clerk/clerk-react";
import { api } from "../../../convex/_generated/api";
import { useSettings } from "../../hooks/useSettings";
import {
  decideAccountLink,
  OWNER_META_KEY,
  type LinkDecision,
} from "../../lib/accountLink";
import {
  clearAllUserData,
  getMeta,
  hasAnyUserData,
  setMeta,
} from "../../lib/db";
import { exportAllChats } from "../../lib/export";
import { SetupHero } from "./SetupHero";
import { Glyph } from "../Glyph";

export interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  return (
    <>
      <AuthLoading>
        <BootScreen label="Signing you in…" />
      </AuthLoading>
      <Unauthenticated>
        <div className="tw:h-dvh tw:grid tw:grid-cols-2 tw:max-[880px]:grid-cols-1">
          <SetupHero />
          <div className="tw:bg-bg-3 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:p-8">
            <SignIn routing="hash" />
            <a
              className="tw:text-[12px] tw:text-ink-3 tw:hover:text-ink"
              href="/legal"
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy · Terms · Refunds
            </a>
          </div>
        </div>
      </Unauthenticated>
      <Authenticated>
        <ManagedBoot>{children}</ManagedBoot>
      </Authenticated>
    </>
  );
}

function ManagedBoot({ children }: { children: ReactNode }) {
  const { user: clerkUser } = useUser();
  const me = useQuery(api.users.current);
  const keyRow = useQuery(
    api.keys.getMine,
    me?.keyStatus === "active" ? {} : "skip",
  );
  const ensure = useMutation(api.users.ensure);
  const { setManagedKey } = useSettings();

  // 3. Create the user row (and schedule key provisioning) if the Clerk
  // webhook hasn't done it yet. Guarded — StrictMode mounts twice and the
  // `me === null` result can repeat across re-renders.
  const ensuredRef = useRef(false);
  useEffect(() => {
    if (me === null && !ensuredRef.current) {
      ensuredRef.current = true;
      void ensure();
    }
  }, [me, ensure]);

  // 6. Account-link check: one-shot per Clerk user id.
  const [link, setLink] = useState<LinkDecision | null>(null);
  const linkCheckedFor = useRef<string | null>(null);
  useEffect(() => {
    const clerkUserId = clerkUser?.id;
    if (!clerkUserId || linkCheckedFor.current === clerkUserId) return;
    linkCheckedFor.current = clerkUserId;
    void (async () => {
      const stored = await getMeta<string>(OWNER_META_KEY);
      const hasData = await hasAnyUserData();
      const decision = decideAccountLink(stored, clerkUserId, hasData);
      if (decision.kind === "fresh") await setMeta(OWNER_META_KEY, clerkUserId);
      setLink(decision);
    })();
  }, [clerkUser?.id]);

  // 7. Push the managed key into settings; clear it when this unmounts
  // (sign-out unmounts <Authenticated>).
  const managedKey = keyRow?.disabled ? "" : keyRow?.apiKey ?? "";
  useEffect(() => {
    setManagedKey(managedKey);
    return () => setManagedKey("");
  }, [managedKey, setManagedKey]);

  if (me === undefined || me === null) {
    return <BootScreen label="Setting up your account…" />;
  }
  if (me.keyStatus === "provisioning") {
    return <BootScreen label="Preparing your account… this takes a few seconds." />;
  }
  if (me.keyStatus === "error" || keyRow === null || keyRow?.disabled) {
    return (
      <ErrorScreen
        label={
          keyRow?.disabled
            ? "Your account is disabled. Contact support if this is unexpected."
            : "We couldn't finish setting up your account."
        }
        retry={
          keyRow?.disabled
            ? null
            : () => {
                ensuredRef.current = false;
                void ensure();
              }
        }
      />
    );
  }
  if (link === null || keyRow === undefined) {
    return <BootScreen label="Loading…" />;
  }
  if (link.kind === "mismatch") {
    return (
      <OwnerMismatch
        onResolved={(clerkUserId) => {
          void setMeta(OWNER_META_KEY, clerkUserId).then(() =>
            setLink({ kind: "match" }),
          );
        }}
      />
    );
  }
  return <>{children}</>;
}

function BootScreen({ label }: { label: string }) {
  return (
    <div className="tw:h-dvh tw:grid tw:place-items-center tw:bg-bg">
      <div className="tw:flex tw:flex-col tw:items-center tw:gap-3 tw:text-ink-3 tw:text-[14px]">
        <Glyph size={28} />
        <span>{label}</span>
      </div>
    </div>
  );
}

function ErrorScreen({
  label,
  retry,
}: {
  label: string;
  retry: (() => void) | null;
}) {
  const { signOut } = useClerk();
  return (
    <div className="tw:h-dvh tw:grid tw:place-items-center tw:bg-bg">
      <div className="tw:flex tw:flex-col tw:items-center tw:gap-4 tw:max-w-[420px] tw:text-center tw:p-8">
        <Glyph size={28} />
        <p className="tw:m-0 tw:text-ink-2 tw:text-[15px]">{label}</p>
        <div className="tw:flex tw:gap-2">
          {retry && (
            <button
              className="tw:bg-coral tw:text-bg tw:py-2.5 tw:px-5 tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:hover:bg-[#ff4520]"
              onClick={retry}
            >
              Try again
            </button>
          )}
          <button
            className="tw:bg-bg-3 tw:text-ink tw:py-2.5 tw:px-5 tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:border-line tw:hover:border-ink-3"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// The blocking three-way choice when this browser's local data belongs to a
// different account. Deliberately NOT a dismissible modal — proceeding
// without a decision could sync one user's chats into another's account.
function OwnerMismatch({
  onResolved,
}: {
  onResolved: (clerkUserId: string) => void;
}) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);

  const wipeAndContinue = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await clearAllUserData();
      onResolved(user.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tw:h-dvh tw:grid tw:place-items-center tw:bg-bg tw:p-8">
      <div className="tw:max-w-[460px] tw:bg-bg-3 tw:border tw:border-line tw:rounded-app tw:p-7">
        <h2 className="tw:m-0 tw:mb-2 tw:font-display tw:font-semibold tw:text-[20px] tw:tracking-[-0.015em]">
          This browser holds another account's data
        </h2>
        <p className="tw:m-0 tw:mb-5 tw:text-ink-2 tw:text-[14px]">
          The chats and graphs stored here were created under a different
          sign-in. To keep accounts separate, export a backup first, then
          either switch back to that account or wipe this browser's data and
          continue as <strong>{user?.primaryEmailAddress?.emailAddress ?? "this account"}</strong>.
        </p>
        <div className="tw:flex tw:flex-col tw:gap-2">
          <button
            className="tw:bg-bg-3 tw:text-ink tw:py-2.5 tw:px-4 tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:border-line tw:hover:border-ink-3"
            disabled={busy}
            onClick={() => {
              void exportAllChats().then(() => setExported(true));
            }}
          >
            {exported ? "Backup downloaded ✓" : "Export backup (JSON)"}
          </button>
          <button
            className="tw:bg-bg-3 tw:text-ink tw:py-2.5 tw:px-4 tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:border-line tw:hover:border-ink-3"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Switch account (sign out)
          </button>
          <button
            className="tw:bg-bg-3 tw:py-2.5 tw:px-4 tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:border-coral tw:text-coral tw:hover:bg-coral-tint"
            disabled={busy}
            onClick={() => void wipeAndContinue()}
          >
            Wipe local data & continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default AuthGate;
