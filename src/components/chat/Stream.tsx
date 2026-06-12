// src/components/chat/Stream.tsx
// Renders the conversation along root → currentNodeId. Mounts the live
// streaming-tail message when useStream is active, auto-scrolls on new
// content, and exposes a ref the SelectionPopup attaches to.
//
// When `reflectionsMode` is true the per-node banner is rendered above
// the stream and each message receives the visible edit/delete/merge
// affordances via its own props.

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useLiveQuery }      from "dexie-react-hooks";
import { db, type Message as DbMessage } from "../../lib/db";
import { highlightTermsInElement, clearSearchHighlight } from "../../lib/domHighlight";
import { tokenizeQuery }     from "../../lib/search/service";
import { Message }           from "./Message";
import { MarkdownBody }      from "./MarkdownBody";
import { Reasoning }         from "./Reasoning";

export interface StreamProps {
  currentNodeId:        string;
  /** Scroll to + flash this message once it's rendered (search deep link). */
  focusMessageId?:      string;
  /** Search terms to highlight inside the focused message. */
  focusQuery?:          string;
  streamState:          "idle" | "streaming" | "error";
  /** Follow the reply to the bottom as it streams (user pref, default true). */
  autoScroll:           boolean;
  streamingText:        string;
  streamingReasoning?:  string;
  streamError?:         string;
  /** HTTP status behind `streamError`, when it came from a non-OK response.
   *  A 401 swaps the generic error line for the key-rejected recovery card. */
  streamErrorStatus?:   number;
  /** Invoked from the 401 card: clears the rejected key and returns to setup. */
  onAuthReset?:         () => void;
  onBranchFromMessage?: (msg: DbMessage, quote?: string) => void;
  reflectionsMode?:     boolean;
  onExitReflections?:   () => void;
  onSaveReflection?:    () => void;
  /** Optional banner slot — ChatApp injects the "Collapse to one" action
   *  (with its own inline-confirm UI) here so all collapse logic stays
   *  in ChatApp.tsx. Rendered to the LEFT of Save / Done. */
  collapseAction?:      ReactNode;
}

// Remembers each branch's last scroll offset (keyed by nodeId) so returning to
// a chat lands exactly where the user left off instead of snapping to the
// bottom. Module-scoped so it survives navigating away to /graphs etc. and
// back; bounded by the number of nodes visited this session.
const scrollMemory = new Map<string, number>();

export const Stream = forwardRef<HTMLDivElement, StreamProps>(function Stream(
  {
    currentNodeId,
    focusMessageId,
    focusQuery,
    streamState,
    autoScroll,
    streamingText,
    streamingReasoning,
    streamError,
    streamErrorStatus,
    onAuthReset,
    onBranchFromMessage,
    reflectionsMode = false,
    onExitReflections,
    onSaveReflection,
    collapseAction,
  },
  ref,
) {
  // Messages for the current node only — parent-node messages are sent to the
  // model via buildPathMessages but we don't clutter the UI with them.
  const liveMessages = useLiveQuery(
    () => db.messages
      .where("nodeId").equals(currentNodeId)
      .sortBy("createdAt"),
    [currentNodeId],
  );
  const pathMessages = liveMessages ?? [];

  const bottomRef = useRef<HTMLDivElement | null>(null);

  // The scroll container is the forwarded ref. We also need to read its scroll
  // position locally, so merge an internal ref into the forwarded one.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as MutableRefObject<HTMLDivElement | null>).current = node;
  }, [ref]);

  // True from the moment the viewed node changes until we've applied that
  // node's scroll position. While pending, autoscroll is suppressed so it can't
  // fire against stale/short content mid-switch.
  const restorePendingRef = useRef(true);

  // Shows a "jump to latest" affordance whenever the user is scrolled away from
  // the bottom — so a reply streaming in below the fold (e.g. with autoscroll
  // off) is never silently missed.
  const NEAR_BOTTOM_PX = 80;
  const [showJump, setShowJump] = useState(false);

  // Remember where the user is, live, so returning to a chat lands where they
  // left off (used when autoscroll is off). Skip while a restore is pending —
  // stale content would save a bogus offset under the new node.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || restorePendingRef.current) return;
    scrollMemory.set(currentNodeId, el.scrollTop);
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_BOTTOM_PX);
  }, [currentNodeId]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  // Lift a message toward the top of the viewport (leaving a small gap above
  // and the rest of the space below for the reply), rather than pinning it to
  // the very bottom. Used on send / reply-start when autoscroll is off so the
  // new turn is comfortably on screen.
  const LIFT_GAP_PX = 24;
  const liftIntoView = useCallback((msgId: string, behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    const node = el?.querySelector(`[data-msg-id="${CSS.escape(msgId)}"]`);
    if (el && node instanceof HTMLElement) {
      el.scrollTo({ top: Math.max(0, node.offsetTop - LIFT_GAP_PX), behavior });
    }
  }, []);

  // The messages query lags a frame behind currentNodeId on a node switch
  // (Dexie resolves async). Since the query filters by nodeId, the list is
  // "ready" for this node only once its rows actually carry this nodeId.
  const messagesReady =
    liveMessages !== undefined &&
    (pathMessages.length === 0 || pathMessages[0]!.nodeId === currentNodeId);

  // Arm a restore whenever the viewed node changes (and on first mount).
  useLayoutEffect(() => {
    restorePendingRef.current = true;
  }, [currentNodeId]);

  // Once the new node's content has rendered (true height), place the scroll:
  // returning to a node we've seen before lands at the saved offset — leaving a
  // chat and coming back continues where you left off rather than snapping to
  // the bottom. Only a node with no remembered position (first visit) starts at
  // the bottom. The `autoScroll` pref governs following a *live* stream, not
  // this initial placement. One-shot per node entry — clears the pending flag.
  useLayoutEffect(() => {
    if (!restorePendingRef.current || !messagesReady) return;
    const el = scrollRef.current;
    if (!el) return;
    const saved = scrollMemory.get(currentNodeId);
    if (saved !== undefined) {
      el.scrollTop = saved;
    } else {
      el.scrollTop = el.scrollHeight;
    }
    restorePendingRef.current = false;
  }, [currentNodeId, messagesReady, autoScroll]);

  // Reveal a message the user just sent — even when autoscroll is off — then
  // leave the streaming reply alone. Detects an appended user message in the
  // *same* node (not a node switch), and skips the first settled render of each
  // node so a restore isn't undone.
  const prevLenRef      = useRef(pathMessages.length);
  const baselineNodeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!messagesReady || restorePendingRef.current) return;
    const last = pathMessages[pathMessages.length - 1];
    if (baselineNodeRef.current !== currentNodeId) {
      // First settled render for this node: set the baseline, don't scroll.
      baselineNodeRef.current = currentNodeId;
      prevLenRef.current = pathMessages.length;
      return;
    }
    if (pathMessages.length > prevLenRef.current && last?.role === "user") {
      if (autoScroll) {
        bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
      } else {
        // Lift the sent message up a bit so it's clearly on screen with room
        // below for the reply, instead of pinned to the bottom edge.
        liftIntoView(last._id, "instant");
      }
    }
    prevLenRef.current = pathMessages.length;
  }, [pathMessages.length, currentNodeId, messagesReady, autoScroll, liftIntoView]);

  // Even with autoscroll off, reveal the *start* of a reply: when the stream
  // begins, scroll once so the new assistant block is visible, then stop
  // following. (With autoscroll on, the effect below already keeps up.)
  const prevStreamStateRef = useRef(streamState);
  useEffect(() => {
    const justStarted =
      streamState === "streaming" && prevStreamStateRef.current !== "streaming";
    prevStreamStateRef.current = streamState;
    if (justStarted && !restorePendingRef.current && !autoScroll) {
      // Lift the turn (its user message) toward the top so the reply, which
      // renders just below, comes up onto the screen as it begins.
      const last = pathMessages[pathMessages.length - 1];
      if (last) liftIntoView(last._id, "smooth");
      else bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [streamState, autoScroll, pathMessages, liftIntoView]);

  // Standard autoscroll: follow the bottom as content grows — including a
  // thinking model's reasoning (streamingReasoning is in the deps). Gated by
  // the user's autoScroll preference, so it can be turned off in Settings.
  //
  // Skip the first settled render after entering a node: the restore layout
  // effect runs first and clears restorePendingRef in the SAME commit, so
  // without this guard the snap-to-bottom here would immediately undo the
  // saved-offset restore (the bug where returning to a chat jumped to the
  // bottom). Only growth that happens AFTER entry — i.e. a streaming reply —
  // should follow.
  const autoscrollBaselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (restorePendingRef.current || !autoScroll) return;
    if (autoscrollBaselineRef.current !== currentNodeId) {
      autoscrollBaselineRef.current = currentNodeId;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [pathMessages.length, streamingText, streamingReasoning, streamState, autoScroll, currentNodeId]);

  // Recompute the jump affordance as content grows: a reply streaming in below
  // a scrolled-up viewport doesn't fire a scroll event, so reflect it here.
  // Runs after the autoscroll effect, so when following is on the distance
  // reads ~0 and the button stays hidden.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || restorePendingRef.current) return;
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_BOTTOM_PX);
  }, [pathMessages.length, streamingText, streamingReasoning, streamState]);

  // Search deep link: once the target message is rendered, center + flash
  // it, and highlight the matched terms inside it (semantic-only hits may
  // have no literal term — then only the flash shows). Runs in rAF so it
  // lands after the bottom-scroll effect above and wins the scroll
  // position.
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusMessageId || focusedRef.current === focusMessageId) return undefined;
    if (!pathMessages.some(m => m._id === focusMessageId)) return undefined;
    const raf = requestAnimationFrame(() => {
      focusedRef.current = focusMessageId;
      const el = document.querySelector(`[data-msg-id="${CSS.escape(focusMessageId)}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("search-flash");
        setTimeout(() => el.classList.remove("search-flash"), 1600);
        if (focusQuery) highlightTermsInElement(el, tokenizeQuery(focusQuery));
      }
    });
    return () => { cancelAnimationFrame(raf); clearSearchHighlight(); };
  }, [focusMessageId, focusQuery, pathMessages]);

  const isEmpty = liveMessages !== undefined && pathMessages.length === 0 && streamState !== "streaming";

  return (
    <div className="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:scroll-smooth tw:pt-8 tw:px-0 tw:pb-[200px] tw:relative" ref={setScrollRef} onScroll={handleScroll}>
      {reflectionsMode && (
        <div className="tw:sticky tw:top-0 tw:z-[5] tw:flex tw:items-center tw:gap-3 tw:py-2.5 tw:px-[22px] tw:bg-lilac tw:text-white tw:dark:text-[#0e0a14] tw:text-[13px] tw:border-b tw:border-b-[color-mix(in_oklab,var(--lilac)_60%,black)]" role="status" aria-live="polite">
          <svg className="tw:w-5 tw:h-5 tw:flex-none" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 10 Q10 4 17 10 Q10 16 3 10 Z" stroke="currentColor" strokeWidth="1.6" fill="none"/>
            <circle cx="10" cy="10" r="2" fill="currentColor"/>
          </svg>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div className="tw:font-medium">Reflections — tidying the current path</div>
            <div className="tw:opacity-[0.78] tw:font-mono tw:text-[11px]">Click to edit. Delete the noise. Merge what belongs together. Press ⌃R to exit.</div>
          </div>
          <div className="tw:ml-auto tw:flex tw:gap-2 tw:flex-none">
            {collapseAction}
            {onSaveReflection && (
              <button className="tw:py-[5px] tw:px-3 tw:rounded-[7px] tw:text-[12px] tw:font-medium tw:border tw:cursor-pointer tw:transition-[background-color] tw:duration-[120ms] tw:ease-[ease] tw:bg-[var(--veil-white-14)] tw:text-white tw:border-[var(--veil-white-18)] tw:hover:bg-[var(--veil-white-22)] tw:dark:bg-[var(--veil-deep-14)] tw:dark:text-[#0e0a14] tw:dark:border-[var(--veil-deep-22)]" onClick={() => onSaveReflection()} title="Snapshot this path into your reflections">
                Save as reflection
              </button>
            )}
            {onExitReflections && (
              <button className="tw:py-[5px] tw:px-3 tw:rounded-[7px] tw:text-[12px] tw:font-medium tw:border tw:cursor-pointer tw:transition-[background-color] tw:duration-[120ms] tw:ease-[ease] tw:bg-white tw:text-lilac tw:border-white tw:hover:bg-[color-mix(in_oklab,white_90%,var(--lilac))] tw:dark:bg-[#0e0a14] tw:dark:text-lilac tw:dark:border-[#0e0a14]" onClick={() => onExitReflections()}>
                Done
              </button>
            )}
          </div>
        </div>
      )}

      <div className="tw:max-w-[780px] tw:mx-auto tw:py-0 tw:px-8 tw:flex tw:flex-col tw:gap-[26px]">
        {isEmpty && (
          <div className="tw:flex-1 tw:grid tw:place-items-center tw:py-[60px] tw:px-8 tw:text-ink-3 tw:min-h-[240px]">
            <div className="tw:text-center tw:max-w-[520px]">
              <p className="tw:text-[16px] tw:text-ink-2 tw:mt-0 tw:mb-6">Send your first message to grow this branch.</p>
            </div>
          </div>
        )}

        {pathMessages.map((msg, i) => {
          const prev = i > 0 ? pathMessages[i - 1] : undefined;
          return (
            <Message
              key={msg._id}
              message={msg}
              reflectionsMode={reflectionsMode}
              {...(prev !== undefined ? { prevMessage: prev } : {})}
              {...(onBranchFromMessage
                ? { onBranch: (quote?: string) => onBranchFromMessage(msg, quote) }
                : {})}
            />
          );
        })}

        {streamState === "streaming" && (
          <div className="msg assistant tw:flex tw:flex-col tw:gap-1.5 tw:relative tw:items-start">
            <div className="tw:flex tw:items-center tw:gap-2 tw:font-mono tw:text-[10px] tw:tracking-[0.1em] tw:text-ink-3 tw:uppercase">
              <span>assistant</span>
            </div>
            <div className="m-body">
              {streamingReasoning ? (
                <Reasoning text={streamingReasoning} streaming />
              ) : null}
              {streamingText
                ? <>
                    <MarkdownBody text={streamingText} />
                    <span className="thinking" aria-hidden="true"><i /></span>
                  </>
                : !streamingReasoning
                  ? <div className="thinking"><i /><i /><i /></div>
                  : null}
            </div>
          </div>
        )}

        {streamState === "error" && (
          streamErrorStatus === 401 ? (
            <div className="msg assistant tw:flex tw:flex-col tw:gap-1.5 tw:relative tw:items-start">
              <div
                className="m-body auth-reset-card"
                role="alert"
                style={{
                  border: "1px solid var(--coral)",
                  borderRadius: 12,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <strong style={{ color: "var(--coral)" }}>
                  Your API key was rejected
                </strong>
                <span style={{ opacity: 0.8 }}>
                  OpenRouter refused this key (HTTP 401) — it may have been
                  revoked or is no longer valid. Clear it and reconnect to
                  continue.
                </span>
                <div>
                  <button
                    className="tw:bg-coral tw:text-bg tw:py-3 tw:px-5 tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:w-full tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:bg-[#ff4520] tw:dark:hover:bg-[color-mix(in_oklab,var(--ink)_88%,var(--bg))]"
                    type="button"
                    onClick={() => onAuthReset?.()}
                  >
                    Clear key &amp; return to setup
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="msg assistant tw:flex tw:flex-col tw:gap-1.5 tw:relative tw:items-start">
              <div className="m-body" role="alert" style={{ color: "var(--coral)" }}>
                <strong>Stream error:</strong>{" "}
                {streamError ?? "Unknown error — see browser console for details."}
                {streamErrorStatus !== undefined ? ` (HTTP ${streamErrorStatus})` : ""}
              </div>
            </div>
          )
        )}

        <div ref={bottomRef} />
      </div>

      {showJump && (
        <div className="tw:sticky tw:bottom-[120px] tw:z-[8] tw:flex tw:justify-end tw:pr-6 tw:pointer-events-none">
          <button
            type="button"
            onClick={scrollToBottom}
            title={streamState === "streaming" ? "AI is responding — jump to latest" : "Jump to latest"}
            aria-label={streamState === "streaming" ? "AI is responding — jump to latest" : "Jump to latest"}
            className="tw:pointer-events-auto tw:relative tw:grid tw:place-items-center tw:w-9 tw:h-9 tw:rounded-full tw:bg-bg-3 tw:text-ink tw:border tw:border-line tw:shadow-2 tw:transition-[border-color,transform] tw:duration-[120ms] tw:ease-[ease] tw:hover:border-ink-3 tw:hover:[transform:translateY(-1px)]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3 V12 M4 8.5 L8 12.5 L12 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {streamState === "streaming" && (
              <span className="tw:absolute tw:-top-0.5 tw:-right-0.5 tw:w-2.5 tw:h-2.5 tw:rounded-full tw:bg-coral tw:border-2 tw:border-bg-3 tw:animate-pulse" aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </div>
  );
});

export default Stream;
