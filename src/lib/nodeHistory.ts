// src/lib/nodeHistory.ts
// A small localStorage-backed MRU ("most recently used") list of node ids.
// Powers QuickJump's Alt+Tab-style branch ordering. No React — pure module.

const KEY = "cogninode_node_mru";
const CAP = 80;

/** Returns the MRU list of node ids, most-recently-visited first. */
export function getNodeMRU(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** Moves `nodeId` to the front of the MRU list, deduped and capped at 80. */
export function recordNodeVisit(nodeId: string): void {
  if (!nodeId) return;
  try {
    const next = [nodeId, ...getNodeMRU().filter(id => id !== nodeId)].slice(0, CAP);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore — private mode / quota */
  }
}
