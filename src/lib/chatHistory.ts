// src/lib/chatHistory.ts
// A small localStorage-backed MRU ("most recently used") list of chat ids.
// Powers QuickJump's Alt+Tab-style ordering. No React — pure module.

const KEY = "cogninode_chat_mru";
const CAP = 50;

/** Returns the MRU list of chat ids, most-recently-visited first. */
export function getChatMRU(): string[] {
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

/** Moves `chatId` to the front of the MRU list, deduped and capped at 50. */
export function recordChatVisit(chatId: string): void {
  if (!chatId) return;
  try {
    const next = [chatId, ...getChatMRU().filter(id => id !== chatId)].slice(0, CAP);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore — private mode / quota */
  }
}
