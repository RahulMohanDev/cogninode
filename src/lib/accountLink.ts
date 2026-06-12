// src/lib/accountLink.ts
// Links this browser's local IndexedDB data to a Clerk account. The first
// signed-in account stamps its id into Dexie meta; a later sign-in with a
// DIFFERENT account must not silently absorb (or sync away) someone else's
// local data, so it gets a blocking choice instead. Pure decision logic —
// the gate does the I/O.

export const OWNER_META_KEY = "ownerClerkUserId";

export type LinkDecision =
  | { kind: "fresh" }                                // stamp and proceed
  | { kind: "match" }                                // proceed
  | { kind: "mismatch"; previousOwner: string };     // block, ask the user

export function decideAccountLink(
  storedOwner: string | undefined,
  clerkUserId: string,
  hasLocalData: boolean,
): LinkDecision {
  if (!storedOwner) return { kind: "fresh" };
  if (storedOwner === clerkUserId) return { kind: "match" };
  // A stale owner stamp over an EMPTY browser (wiped, or never used) isn't
  // worth blocking on — restamp to the new account.
  if (!hasLocalData) return { kind: "fresh" };
  return { kind: "mismatch", previousOwner: storedOwner };
}
