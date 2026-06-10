// src/pages/Chat.tsx
// Thin wrapper around <ChatApp />. Reads :chatId from the route,
// optional `node` and `prefill` from the query string. If `node` is
// provided, syncs it into Dexie once on mount.

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useLiveQuery }      from "dexie-react-hooks";
import { db }                from "../lib/db";
import { ChatApp }           from "../components/chat/ChatApp";

export default function Chat() {
  const params = useParams<{ chatId: string }>();
  const chatId = params.chatId ?? "";
  const [search] = useSearchParams();
  const node    = search.get("node");
  const prefill = search.get("prefill");
  const focusMessageId = search.get("msg");   // deep link from search
  const focusQuery     = search.get("q");     // terms to highlight there

  // Sync the optional ?node= query into Dexie's currentNodeId, once per chatId.
  const syncedNodeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatId || !node) return;
    if (syncedNodeRef.current === `${chatId}:${node}`) return;
    syncedNodeRef.current = `${chatId}:${node}`;
    void db.chats.update(chatId, { currentNodeId: node });
  }, [chatId, node]);

  // useLiveQuery returns `undefined` while pending OR when the row is missing.
  // We can't distinguish by value alone, so we use a short grace timer: if
  // the chat is still undefined after ~200ms, treat it as "not found".
  const chat = useLiveQuery(
    () => chatId ? db.chats.get(chatId) : undefined,
    [chatId],
  );

  const [tookTooLong, setTookTooLong] = useState(false);
  useEffect(() => {
    setTookTooLong(false);
    if (!chatId) return;
    const t = setTimeout(() => setTookTooLong(true), 250);
    return () => clearTimeout(t);
  }, [chatId]);

  if (!chatId) {
    return (
      <div className="tw:flex-1 tw:grid tw:place-items-center tw:py-[60px] tw:px-8 tw:text-ink-3">
        <div className="tw:text-center tw:max-w-[520px]">
          <h2 className="tw:font-display tw:font-semibold tw:text-[38px] tw:tracking-[-0.025em] tw:text-ink tw:mt-[18px] tw:mx-0 tw:mb-3 tw:leading-none">No chat <em className="tw:font-serif tw:italic tw:text-coral tw:font-normal">id</em>.</h2>
          <p className="tw:text-[16px] tw:text-ink-2 tw:mt-0 tw:mb-6"><Link to="/">Back to all chats →</Link></p>
        </div>
      </div>
    );
  }

  if (chat === undefined && tookTooLong) {
    return (
      <div className="tw:flex-1 tw:grid tw:place-items-center tw:py-[60px] tw:px-8 tw:text-ink-3">
        <div className="tw:text-center tw:max-w-[520px]">
          <h2 className="tw:font-display tw:font-semibold tw:text-[38px] tw:tracking-[-0.025em] tw:text-ink tw:mt-[18px] tw:mx-0 tw:mb-3 tw:leading-none">Chat <em className="tw:font-serif tw:italic tw:text-coral tw:font-normal">not found</em>.</h2>
          <p className="tw:text-[16px] tw:text-ink-2 tw:mt-0 tw:mb-6">
            That chat doesn't exist in this browser.{" "}
            <Link to="/" style={{ color: "var(--coral)", textDecoration: "underline" }}>
              Back to all chats →
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return <ChatApp chatId={chatId} initialPrefill={prefill} focusMessageId={focusMessageId} focusQuery={focusQuery} />;
}
