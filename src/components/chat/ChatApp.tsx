// src/components/chat/ChatApp.tsx
// The chat shell: sidebar + stream + composer + overlays/settings. Owns the
// streaming hook so both Stream (for the tail) and Composer (for state)
// can share it. Drives branching from selection + per-message actions.
//
// Also owns the `reflectionsMode` flag (⌃R) and the "save as reflection"
// snapshot action — see spec section 11.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery }        from "dexie-react-hooks";
import { db, createBranch, newId, type Message as DbMessage, type Node as DbNode } from "../../lib/db";
import { useStream }           from "../../hooks/useStream";
import { useSettings }         from "../../hooks/useSettings";
import { useDocumentTitle }    from "../../hooks/useDocumentTitle";
import { useSettingsHotkey }   from "../../hooks/useSettingsHotkey";
import { anyModalOpen }        from "../../hooks/useModalStack";
import { findPath }            from "../../lib/path";
import { recordNodeVisit }     from "../../lib/nodeHistory";
import { Sidebar }             from "./Sidebar";
import { Stream }              from "./Stream";
import { Composer }            from "./Composer";
import { SelectionPopup }      from "./SelectionPopup";
import { Overlays }            from "./Overlays";
import { SaveReflectionDialog } from "./SaveReflectionDialog";
import { AddToGraphDialog }    from "../graph/AddToGraphDialog";
import { SettingsModal }       from "../settings/SettingsModal";

export interface ChatAppProps {
  chatId:         string;
  initialPrefill: string | null;
  /** Message to scroll to + flash after load (search deep link). */
  focusMessageId?: string | null;
  /** Search terms to highlight inside the focused message. */
  focusQuery?: string | null;
}

export function ChatApp({ chatId, initialPrefill, focusMessageId, focusQuery }: ChatAppProps) {
  const { prefs, clearApiKey } = useSettings();

  const chat = useLiveQuery(() => db.chats.get(chatId), [chatId]);
  const currentNodeId = chat?.currentNodeId ?? chat?.rootNodeId ?? "";
  useDocumentTitle(chat?.title);

  // Record the active branch as most-recently-visited whenever it changes —
  // feeds QuickJump's node MRU ("Alt+Tab") ordering. Every way the branch
  // changes (sidebar, branch creation, TreeMap, breadcrumb, QuickJump) funnels
  // through `db.chats.update(chatId, { currentNodeId })`, so this single effect
  // captures them all. Skip the empty-string fallback emitted while the chat
  // record is still loading.
  useEffect(() => {
    if (currentNodeId) recordNodeVisit(currentNodeId);
  }, [currentNodeId]);

  // Live: all nodes for the chat — needed for the TopBar breadcrumb.
  const nodes = useLiveQuery<DbNode[], DbNode[]>(
    () => db.nodes.where("chatId").equals(chatId).toArray(),
    [chatId],
    [],
  );

  // Breadcrumb data: root + ancestor labels along root → currentNodeId.
  const breadcrumb = useMemo(() => {
    if (!currentNodeId) return [] as DbNode[];
    const ids = findPath(nodes, currentNodeId);
    const map = new Map(nodes.map(n => [n._id, n]));
    return ids
      .map(id => map.get(id))
      .filter((n): n is DbNode => !!n);
  }, [nodes, currentNodeId]);

  const { state, streamingText, streamingReasoning, error: streamError, errorStatus: streamErrorStatus, send, cancel } = useStream(chatId, currentNodeId);

  // Branch quote — passed to Composer as a chip when branching from selection
  // or from a message's "Branch from this" action.
  const [quote, setQuote] = useState<string | undefined>(undefined);
  // Whether the active quote came from branching or from "continue in chat" —
  // drives the Composer chip label.
  const [quoteKind, setQuoteKind] = useState<"branch" | "continue">("branch");

  // The quote chip belongs to the chat it was branched in. Switching chats
  // (e.g. "New chat") reuses this component with a different chatId without
  // unmounting, so clear any leftover quote on chat change. Branching stays
  // within the same chat, so this never clears a freshly-set branch quote.
  useEffect(() => {
    setQuote(undefined);
  }, [chatId]);

  // Initial prefill applied once via Composer's `initialText` prop.
  const [prefill, setPrefill] = useState<string | null>(initialPrefill);

  const [settingsOpen,       setSettingsOpen]       = useState(false);
  const [reflectionsMode,    setReflectionsMode]    = useState(false);
  const [collapseConfirm,    setCollapseConfirm]    = useState(false);
  const [saveReflectionOpen, setSaveReflectionOpen] = useState(false);
  const [addToGraphOpen,     setAddToGraphOpen]     = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);

  // ⌃, / ⌘, — advertised in the shortcuts sheet.
  useSettingsHotkey(() => setSettingsOpen(true));

  // The transient !chat shell below flashes "Loading…" for a frame on warm
  // Dexie reads. Only show the hint once loading has taken noticeably long.
  const [showLoadingHint, setShowLoadingHint] = useState(false);
  useEffect(() => {
    if (chat) {
      setShowLoadingHint(false);
      return undefined;
    }
    const t = setTimeout(() => setShowLoadingHint(true), 150);
    return () => clearTimeout(t);
  }, [chat]);

  // Live count of messages on the current node — drives the Collapse-to-one
  // button's disabled state + the "Collapse N messages…" confirm label.
  const currentNodeMessages = useLiveQuery(
    () => currentNodeId
      ? db.messages.where("nodeId").equals(currentNodeId).count()
      : Promise.resolve(0),
    [currentNodeId],
    0,
  );

  // Clear the prefill after first apply so navigating between nodes inside
  // this chat doesn't keep re-applying it.
  useEffect(() => {
    if (prefill !== null && chat) {
      // Defer one tick so the Composer's initial mount picks it up first.
      const t = setTimeout(() => setPrefill(null), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [prefill, chat]);

  // ⌃R / ⌘R — toggle reflections mode. Guard against firing while the user
  // is typing in an input / textarea / contenteditable (same pattern as
  // Overlays.tsx). Browser's default for ⌘R is "reload page" so we always
  // preventDefault when our modifier+key combo fires outside a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key !== "r" && e.key !== "R") return;

      const t = e.target as HTMLElement | null;
      const inField = !!t && (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      );
      if (inField || anyModalOpen()) return;

      e.preventDefault();
      setReflectionsMode(v => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Esc cancels an in-flight stream — promised by the shortcuts sheet. The
  // modal stack owns Esc while anything modal is open (it marks the event
  // defaultPrevented), so a single press never closes an overlay AND kills
  // the stream.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (anyModalOpen()) return;
      if (state === "streaming") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, cancel]);

  const handleBranchFromSelection = async (text: string): Promise<void> => {
    if (!chat) return;
    const truncated = text.length > 80 ? text.slice(0, 80) + "…" : text;
    const label     = text.length > 60 ? text.slice(0, 60) + "…" : text;
    const parent    = await db.nodes.get(currentNodeId);
    if (!parent) return;
    // Wrap createBranch + optional revert in one outer transaction so the
    // Dexie live-query observers see a single committed state. createBranch's
    // inner transaction joins this one, avoiding a brief flicker where
    // currentNodeId jumps to the new node and then back when in "stay" mode.
    const stayMode = prefs.branchMode === "stay";
    const stayNodeId = currentNodeId;
    await db.transaction("rw", db.nodes, db.chats, async () => {
      await createBranch({
        chatId,
        parentId: stayNodeId,
        depth:    parent.depth + 1,
        label,
      });
      if (stayMode) {
        await db.chats.update(chatId, { currentNodeId: stayNodeId });
        // we still surface the quote; user can navigate to the branch later
      }
    });
    setQuote(truncated);
    setQuoteKind("branch");
    // No further action — the Composer picks up the new currentNodeId
    // reactively via `chat.currentNodeId`.
  };

  // "Continue in same chat" — attach the selection as a quote to the *current*
  // node without branching. The next message carries it as context (db.ts
  // prepends the quoted block), so the user can follow up on a passage inline.
  const handleContinueWithSelection = (text: string): void => {
    const truncated = text.length > 80 ? text.slice(0, 80) + "…" : text;
    setQuote(truncated);
    setQuoteKind("continue");
  };

  const handleBranchFromMessage = async (_msg: DbMessage, maybeQuote?: string): Promise<void> => {
    await handleBranchFromSelection(maybeQuote ?? "Branch");
  };

  // Standalone "+ new branch" affordance — creates an empty branch from the
  // current node with no quote chip and no message context. Honours the user's
  // branchMode preference the same way handleBranchFromSelection does.
  const handleCreateBlankBranch = async (): Promise<void> => {
    if (!chat) return;
    const parent = await db.nodes.get(currentNodeId);
    if (!parent) return;
    const stayMode = prefs.branchMode === "stay";
    const stayNodeId = currentNodeId;
    await db.transaction("rw", db.nodes, db.chats, async () => {
      await createBranch({
        chatId,
        parentId: stayNodeId,
        depth:    parent.depth + 1,
        label:    "New branch",
      });
      if (stayMode) {
        await db.chats.update(chatId, { currentNodeId: stayNodeId });
      }
    });
    // No quote chip — this is a fresh branch, not a quoted side-track.
  };

  // "Save as reflection" opens a confirm dialog (SaveReflectionDialog) that
  // composes the path snapshot, lets the user title it / include reasoning,
  // and reports success or failure via toasts. The snapshot logic lives in
  // lib/reflections.ts.

  // ── Collapse-to-one ────────────────────────────────────────────────────
  // Concatenate every message on the current node into a single user-role
  // message with markdown role headers, then delete the originals. One
  // Dexie transaction so live-queries see a single committed swap.
  const handleCollapseToOne = useCallback(async (): Promise<void> => {
    if (!chat || !currentNodeId) return;
    const msgs = await db.messages
      .where("nodeId").equals(currentNodeId)
      .sortBy("createdAt");
    if (msgs.length < 2) return;   // nothing to collapse

    const blocks = msgs.map(m => {
      const header = m.role === "user" ? "## You" : "## Assistant";
      return `${header}\n\n${m.content}`;
    });
    const merged = blocks.join("\n\n---\n\n");

    // Preserve every referenced file id across the collapsed message so any
    // attachments stay reachable from chips on the new user message.
    const allFileIds = msgs.flatMap(m => m.fileIds ?? []);
    const dedupedFiles = allFileIds.length > 0
      ? Array.from(new Set(allFileIds))
      : undefined;

    const first = msgs[0]!;
    const newMsg: DbMessage = {
      _id:       newId(),
      nodeId:    currentNodeId,
      chatId,
      role:      "user",
      content:   merged,
      // sort first; matching firstMessage.createdAt is fine since we wipe
      // the rest in the same transaction.
      createdAt: first.createdAt,
      ...(dedupedFiles !== undefined ? { fileIds: dedupedFiles } : {}),
    };

    await db.transaction("rw", db.messages, async () => {
      await db.messages.bulkDelete(msgs.map(m => m._id));
      await db.messages.add(newMsg);
    });
  }, [chat, chatId, currentNodeId]);

  // Auto-revert the inline collapse-confirm after 4s — same pattern as
  // Message.tsx's delete-confirm pill so the UI never lingers.
  useEffect(() => {
    if (!collapseConfirm) return undefined;
    const t = setTimeout(() => setCollapseConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [collapseConfirm]);

  // Exiting reflections mode always clears any pending confirm.
  useEffect(() => {
    if (!reflectionsMode) setCollapseConfirm(false);
  }, [reflectionsMode]);

  // Build the banner-slot element. `disabled` when there's nothing to merge.
  // Clicking the button swaps the action row for an inline confirm (matching
  // the delete-confirm pattern in Message.tsx).
  const collapseDisabled = (currentNodeMessages ?? 0) < 2;
  const collapseAction = collapseConfirm ? (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px",
        borderRadius: 7,
        background: "color-mix(in oklab, white 14%, transparent)",
        fontSize: 12,
        color: "white",
      }}
    >
      <span>Collapse {currentNodeMessages ?? 0} messages into one?</span>
      <button
        className="tw:py-[5px] tw:px-3 tw:rounded-[7px] tw:text-[12px] tw:font-medium tw:border tw:cursor-pointer tw:transition-[background-color] tw:duration-[120ms] tw:ease-[ease] tw:bg-[var(--veil-white-14)] tw:text-white tw:border-[var(--veil-white-18)] tw:hover:bg-[var(--veil-white-22)] tw:dark:bg-[var(--veil-deep-14)] tw:dark:text-[#0e0a14] tw:dark:border-[var(--veil-deep-22)]"
        onClick={() => { void handleCollapseToOne(); setCollapseConfirm(false); }}
        style={{
          padding: "2px 8px",
          borderRadius: 5,
          background: "white",
          color: "var(--lilac)",
          fontWeight: 600,
        }}
      >
        yes
      </button>
      <button
        className="tw:py-[5px] tw:px-3 tw:rounded-[7px] tw:text-[12px] tw:font-medium tw:border tw:cursor-pointer tw:transition-[background-color] tw:duration-[120ms] tw:ease-[ease] tw:bg-[var(--veil-white-14)] tw:text-white tw:border-[var(--veil-white-18)] tw:hover:bg-[var(--veil-white-22)] tw:dark:bg-[var(--veil-deep-14)] tw:dark:text-[#0e0a14] tw:dark:border-[var(--veil-deep-22)]"
        onClick={() => setCollapseConfirm(false)}
        style={{
          padding: "2px 8px",
          borderRadius: 5,
          background: "transparent",
          color: "white",
          border: "1px solid color-mix(in oklab, white 40%, transparent)",
        }}
      >
        cancel
      </button>
    </span>
  ) : (
    <button
      className="tw:py-[5px] tw:px-3 tw:rounded-[7px] tw:text-[12px] tw:font-medium tw:border tw:cursor-pointer tw:transition-[background-color] tw:duration-[120ms] tw:ease-[ease] tw:bg-[var(--veil-white-14)] tw:text-white tw:border-[var(--veil-white-18)] tw:hover:bg-[var(--veil-white-22)] tw:dark:bg-[var(--veil-deep-14)] tw:dark:text-[#0e0a14] tw:dark:border-[var(--veil-deep-22)]"
      type="button"
      onClick={() => setCollapseConfirm(true)}
      disabled={collapseDisabled}
      title={collapseDisabled
        ? "Need at least 2 messages on this node to collapse"
        : "Concatenate every message on this node into one user message"}
      style={collapseDisabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
    >
      Collapse to one
    </button>
  );

  if (!chat) {
    // Caller (Chat page) is responsible for the "not found" empty state,
    // but if we hit a transient loading state, render a minimal shell.
    return (
      <div className={`tw:grid tw:h-dvh tw:w-screen tw:transition-[grid-template-columns] tw:duration-[220ms] tw:ease-[cubic-bezier(0.4,0,0.2,1)] tw:motion-reduce:transition-none ${prefs.sidebarCollapsed ? "tw:grid-cols-[60px_1fr]" : "tw:grid-cols-[268px_1fr]"}`}>
        <Sidebar activeChatId={chatId} onOpenSettings={() => setSettingsOpen(true)} />
        <div className="tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:h-full tw:bg-bg-3 tw:relative tw:overflow-hidden">
          <div className="tw:flex-1 tw:grid tw:place-items-center tw:py-[60px] tw:px-8 tw:text-ink-3">
            <div className="tw:text-center tw:max-w-[520px]">
              {showLoadingHint && (
                <p className="tw:text-[16px] tw:text-ink-2 tw:mt-0 tw:mb-6 tw:animate-[fadeIn_0.14s_ease-out]">Loading…</p>
              )}
            </div>
          </div>
        </div>
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    );
  }

  return (
    <div className={`tw:grid tw:h-dvh tw:w-screen tw:transition-[grid-template-columns] tw:duration-[220ms] tw:ease-[cubic-bezier(0.4,0,0.2,1)] tw:motion-reduce:transition-none ${prefs.sidebarCollapsed ? "tw:grid-cols-[60px_1fr]" : "tw:grid-cols-[268px_1fr]"}`}>
      <Sidebar
        activeChatId={chatId}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:h-full tw:bg-bg-3 tw:relative tw:overflow-hidden">
        <TopBar
          title={chat.title}
          breadcrumb={breadcrumb}
          reflectionsActive={reflectionsMode}
          onToggleReflect={() => setReflectionsMode(v => !v)}
          onAddToGraph={() => setAddToGraphOpen(true)}
        />

        <Stream
          ref={streamRef}
          currentNodeId={currentNodeId}
          {...(focusMessageId ? { focusMessageId } : {})}
          {...(focusQuery ? { focusQuery } : {})}
          streamState={state}
          autoScroll={prefs.autoScroll}
          streamingText={streamingText}
          streamingReasoning={streamingReasoning}
          {...(streamError !== null ? { streamError } : {})}
          {...(streamErrorStatus !== undefined ? { streamErrorStatus } : {})}
          onAuthReset={() => {
            // Drop the dead error slot so the node is clean when we come
            // back, then clear the key — the shared settings context flips
            // ApiKeyGate to the setup screen immediately.
            cancel();
            clearApiKey();
          }}
          onBranchFromMessage={(msg, q) => void handleBranchFromMessage(msg, q)}
          reflectionsMode={reflectionsMode}
          onExitReflections={() => setReflectionsMode(false)}
          onSaveReflection={() => setSaveReflectionOpen(true)}
          collapseAction={collapseAction}
        />

        <div className="tw:absolute tw:bottom-0 tw:left-0 tw:right-0 tw:pt-3.5 tw:px-8 tw:pb-[18px] tw:bg-[linear-gradient(to_top,var(--bg-3)_60%,transparent)] tw:pointer-events-none">
          <Composer
            chatId={chatId}
            currentNodeId={currentNodeId}
            streamState={state}
            onSend={send}
            onCancel={cancel}
            {...(quote !== undefined ? { quote, quoteKind } : {})}
            {...(prefill !== null   ? { initialText: prefill } : {})}
            onClearQuote={() => setQuote(undefined)}
            onOpenSettings={() => setSettingsOpen(true)}
            onCreateBlankBranch={() => void handleCreateBlankBranch()}
          />
        </div>
      </div>

      {!reflectionsMode && (
        <SelectionPopup
          streamRef={streamRef}
          onBranch={(text) => void handleBranchFromSelection(text)}
          onContinue={(text) => handleContinueWithSelection(text)}
        />
      )}

      <Overlays chatId={chatId} currentNodeId={currentNodeId} />

      <SaveReflectionDialog
        open={saveReflectionOpen}
        chatId={chatId}
        nodeId={currentNodeId}
        onClose={() => setSaveReflectionOpen(false)}
      />

      <AddToGraphDialog
        open={addToGraphOpen}
        target={{ type: "chat", id: chatId, title: chat.title }}
        onClose={() => setAddToGraphOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

export default ChatApp;

// ── Inline TopBar ────────────────────────────────────────────────────────────
// Header bar above the Stream. Owns the breadcrumb (root › parent › this) and
// three pill buttons that open existing overlays/modes. Tree and Jump dispatch
// a synthetic Ctrl+T / Ctrl+Q keydown so the existing global listener in
// Overlays.tsx handles the toggle — keeps the wiring single-sourced. Reflect
// toggles directly via the callback because ChatApp owns that state.


// Breadcrumb chip dot colour by node depth (caps at 3+).
const CRUMB_DOT = ["tw:bg-coral", "tw:bg-teal", "tw:bg-lilac", "tw:bg-butter"];

interface TopBarProps {
  title:             string;
  breadcrumb:        DbNode[];      // root → currentNodeId, inclusive
  reflectionsActive: boolean;
  onToggleReflect:   () => void;
  onAddToGraph:      () => void;
}

function TopBar({ title, breadcrumb, reflectionsActive, onToggleReflect, onAddToGraph }: TopBarProps) {
  const openTree = (): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", ctrlKey: true }));
  };
  const openJump = (): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", ctrlKey: true }));
  };
  const openSearch = (): void => {
    // Handled by the global SearchOverlay's ⌘K listener.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  };

  // Drop the root entry (its label is just "root" / chat-title); show its
  // descendants as crumb chips coloured by depth.
  const tail = breadcrumb.slice(1);

  return (
    <div className="tw:flex tw:items-center tw:gap-3 tw:py-3 tw:px-[22px] tw:border-b tw:border-line tw:bg-bg-3 tw:min-h-[58px]">
      <div className="tw:flex tw:items-center tw:gap-1.5 tw:flex-1 tw:min-w-0 tw:text-[13px] tw:text-ink-3">
        <span className="tw:font-display tw:font-semibold tw:text-[17px] tw:tracking-[-0.015em] tw:text-ink tw:truncate tw:max-w-[320px]" title={title}>{title || "—"}</span>
        {tail.length > 0 && <span className="tw:text-ink-4 tw:mx-0.5">/</span>}
        {tail.map((n, i) => {
          const label = n.label.length > 22 ? n.label.slice(0, 22) + "…" : n.label;
          const last  = i === tail.length - 1;
          return (
            <span key={n._id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="tw:inline-flex tw:items-center tw:gap-[5px] tw:py-[3px] tw:px-[9px] tw:rounded-[999px] tw:bg-bg-2 tw:text-ink-2 tw:text-[12px]" title={n.label}>
                <span className={`tw:w-[7px] tw:h-[7px] tw:rounded-[50%] ${CRUMB_DOT[Math.min(3, n.depth)]}`} />
                {label}
              </span>
              {!last && <span className="tw:text-ink-4 tw:mx-0.5">›</span>}
            </span>
          );
        })}
      </div>

      <div className="tw:flex tw:items-center tw:gap-1.5">
        <button className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-3 tw:rounded-[8px] tw:border tw:text-[13px] tw:transition-[border-color,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:border-line tw:text-ink-2 tw:bg-bg-3 tw:hover:border-ink-3 tw:hover:text-ink" type="button" onClick={openSearch} title="Search everything — messages, reflections, branches">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Search
          <span className="tw:font-mono tw:text-[10px] tw:py-px tw:px-[5px] tw:rounded-[3px] tw:bg-bg-2 tw:text-ink-3">⌘K</span>
        </button>

        <button className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-3 tw:rounded-[8px] tw:border tw:text-[13px] tw:transition-[border-color,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:border-line tw:text-ink-2 tw:bg-bg-3 tw:hover:border-ink-3 tw:hover:text-ink" type="button" onClick={openTree} title="Tree view">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8"  cy="3"  r="2" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="3"  cy="13" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="13" cy="13" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M8 5 V8 M8 8 L3 11 M8 8 L13 11"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Tree
          <span className="tw:font-mono tw:text-[10px] tw:py-px tw:px-[5px] tw:rounded-[3px] tw:bg-bg-2 tw:text-ink-3">⌃T</span>
        </button>

        <button
          className={`tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-3 tw:rounded-[8px] tw:border tw:text-[13px] tw:transition-[border-color,background-color,color] tw:duration-[120ms] tw:ease-[ease] ${reflectionsActive ? "tw:bg-lilac tw:border-lilac tw:text-white tw:hover:bg-[#6b4cf0] tw:hover:border-[#6b4cf0]" : "tw:border-line tw:text-ink-2 tw:bg-bg-3 tw:hover:border-ink-3 tw:hover:text-ink"}`}
          type="button"
          onClick={onToggleReflect}
          title="Reflections mode"
          aria-pressed={reflectionsActive}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8 a5 5 0 1 1 10 0 a5 5 0 1 1 -10 0 Z" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M5.5 7 Q8 4 10.5 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
          </svg>
          Reflect
          <span className={`tw:font-mono tw:text-[10px] tw:py-px tw:px-[5px] tw:rounded-[3px] ${reflectionsActive ? "tw:bg-[var(--veil-white-18)] tw:text-[var(--veil-white-80)]" : "tw:bg-bg-2 tw:text-ink-3"}`}>⌃R</span>
        </button>

        <button className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-3 tw:rounded-[8px] tw:border tw:text-[13px] tw:transition-[border-color,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:border-line tw:text-ink-2 tw:bg-bg-3 tw:hover:border-ink-3 tw:hover:text-ink" type="button" onClick={openJump} title="Quick jump">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10 L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Jump
          <span className="tw:font-mono tw:text-[10px] tw:py-px tw:px-[5px] tw:rounded-[3px] tw:bg-bg-2 tw:text-ink-3">⌃Q</span>
        </button>

        <button
          className="tw:w-[34px] tw:h-[34px] tw:grid tw:place-items-center tw:rounded-[8px] tw:border tw:border-line tw:text-ink-2 tw:bg-bg-3 tw:transition-[border-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:border-ink-3 tw:hover:text-ink"
          type="button"
          onClick={onAddToGraph}
          title="Add this chat to a knowledge graph"
          aria-label="Add this chat to a knowledge graph"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="4" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="12.5" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="6.5" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.6 5 L11 6 M5 5.7 L6.2 10.8 M7.9 11.7 L11.3 7.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
