// src/hooks/usePathMessages.ts
import { useLiveQuery }      from "dexie-react-hooks";
import { buildPathMessages } from "../lib/db";

export type PathMessage = { role: "user" | "assistant"; content: string | unknown[] };

/**
 * Reactive wrapper around buildPathMessages(chatId, nodeId).
 * Returns undefined while loading; the Composer uses this to display
 * the current path length and feed it to the cost estimator.
 */
export function usePathMessages(
  chatId: string,
  nodeId: string,
): PathMessage[] | undefined {
  return useLiveQuery(
    () => buildPathMessages(chatId, nodeId),
    [chatId, nodeId],
  );
}
