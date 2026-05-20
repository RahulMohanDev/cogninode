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
import { findPath }            from "../../lib/path";
import { recordNodeVisit }     from "../../lib/nodeHistory";
import { Sidebar }             from "./Sidebar";
import { Stream }              from "./Stream";
import { Composer }            from "./Composer";
import { SelectionPopup }      from "./SelectionPopup";
import { Overlays }            from "./Overlays";
import { SettingsModal }       from "../settings/SettingsModal";

export interface ChatAppProps {
  chatId:         string;
  initialPrefill: string | null;
}

export function ChatApp({ chatId, initialPrefill }: ChatAppProps) {
  const { prefs } = useSettings();

  const chat = useLiveQuery(() => db.chats.get(chatId), [chatId]);
  const currentNodeId = chat?.currentNodeId ?? chat?.rootNodeId ?? "";

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

  const { state, streamingText, streamingReasoning, error: streamError, send, cancel } = useStream(chatId, currentNodeId);

  // Branch quote — passed to Composer as a chip when branching from selection
  // or from a message's "Branch from this" action.
  const [quote, setQuote] = useState<string | undefined>(undefined);

  // Initial prefill applied once via Composer's `initialText` prop.
  const [prefill, setPrefill] = useState<string | null>(initialPrefill);

  const [settingsOpen,     setSettingsOpen]     = useState(false);
  const [reflectionsMode,  setReflectionsMode]  = useState(false);
  const [collapseConfirm,  setCollapseConfirm]  = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);

  // Live count of messages on the current node — drives the Collapse-to-one
  // button's disabled state + the "Collapse N messages…" confirm label. We
  // only need a count so we just read .length off the cached array.
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
      if (inField) return;

      e.preventDefault();
      setReflectionsMode(v => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    // No further action — the Composer picks up the new currentNodeId
    // reactively via `chat.currentNodeId`.
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

  // Snapshot the current node's distilled path into the reflections table.
  // Body is the messages along root → currentNodeId concatenated as markdown;
  // title is derived from the current node's label (falling back to chat title).
  const handleSaveReflection = useCallback(async (): Promise<void> => {
    if (!chat) return;
    const allNodes = await db.nodes.where("chatId").equals(chatId).toArray();
    const ids = findPath(allNodes, currentNodeId);
    if (ids.length === 0) return;
    const nodeMap = new Map(allNodes.map(n => [n._id, n]));
    const currentNode = nodeMap.get(currentNodeId);

    // Collect messages along the path in order.
    const sections: string[] = [];
    for (const nid of ids) {
      const msgs = await db.messages.where("nodeId").equals(nid).sortBy("createdAt");
      for (const m of msgs) {
        const speaker = m.role === "user" ? "**You**" : "**Assistant**";
        sections.push(`${speaker}\n\n${m.content}`);
      }
    }
    const body = sections.join("\n\n---\n\n");
    const rawTitle =
      (currentNode?.label && currentNode.label.trim()) ||
      chat.title ||
      "Reflection";
    const title = rawTitle.length > 80 ? rawTitle.slice(0, 80) + "…" : rawTitle;

    await db.reflections.put({
      _id:       newId(),
      chatId,
      nodeId:    currentNodeId,
      title,
      body,
      updatedAt: Date.now(),
    });
  }, [chat, chatId, currentNodeId]);

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
      className="rb-collapse-confirm"
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
      <div className="shell">
        <Sidebar activeChatId={chatId} onOpenSettings={() => setSettingsOpen(true)} />
        <div className="main">
          <div className="empty">
            <div className="empty-inner">
              <p>Loading…</p>
            </div>
          </div>
        </div>
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    );
  }

  return (
    <div className="shell">
      <Sidebar
        activeChatId={chatId}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="main">
        <TopBar
          title={chat.title}
          breadcrumb={breadcrumb}
          reflectionsActive={reflectionsMode}
          onToggleReflect={() => setReflectionsMode(v => !v)}
        />

        <Stream
          ref={streamRef}
          chatId={chatId}
          currentNodeId={currentNodeId}
          streamState={state}
          streamingText={streamingText}
          streamingReasoning={streamingReasoning}
          {...(streamError !== null ? { streamError } : {})}
          onBranchFromMessage={(msg, q) => void handleBranchFromMessage(msg, q)}
          reflectionsMode={reflectionsMode}
          onExitReflections={() => setReflectionsMode(false)}
          onSaveReflection={() => void handleSaveReflection()}
          collapseAction={collapseAction}
        />

        <div className="composer-wrap">
          <Composer
            chatId={chatId}
            currentNodeId={currentNodeId}
            streamState={state}
            onSend={send}
            onCancel={cancel}
            {...(quote !== undefined ? { quote } : {})}
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
        />
      )}

      <Overlays chatId={chatId} currentNodeId={currentNodeId} />

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

interface TopBarProps {
  title:             string;
  breadcrumb:        DbNode[];      // root → currentNodeId, inclusive
  reflectionsActive: boolean;
  onToggleReflect:   () => void;
}

function TopBar({ title, breadcrumb, reflectionsActive, onToggleReflect }: TopBarProps) {
  const openTree = (): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", ctrlKey: true }));
  };
  const openJump = (): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", ctrlKey: true }));
  };

  // Drop the root entry (its label is just "root" / chat-title); show its
  // descendants as crumb chips coloured by depth.
  const tail = breadcrumb.slice(1);

  return (
    <div className="topbar">
      <div className="crumb">
        <span className="c-title" title={title}>{title || "—"}</span>
        {tail.length > 0 && <span className="c-sep">/</span>}
        {tail.map((n, i) => {
          const label = n.label.length > 22 ? n.label.slice(0, 22) + "…" : n.label;
          const last  = i === tail.length - 1;
          return (
            <span key={n._id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className={`c-node d${Math.min(3, n.depth)}`}>
                <span className="c-dot" />
                {label}
              </span>
              {!last && <span className="c-sep">›</span>}
            </span>
          );
        })}
      </div>

      <div className="topbar-actions">
        <button className="tb-btn" type="button" onClick={openTree} title="Tree view">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8"  cy="3"  r="2" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="3"  cy="13" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="13" cy="13" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M8 5 V8 M8 8 L3 11 M8 8 L13 11"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Tree
          <span className="tb-kbd">⌃T</span>
        </button>

        <button
          className={`tb-btn ${reflectionsActive ? "lilac" : ""}`}
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
          <span className="tb-kbd">⌃R</span>
        </button>

        <button className="tb-btn" type="button" onClick={openJump} title="Quick jump">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10 L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Jump
          <span className="tb-kbd">⌃Q</span>
        </button>
      </div>
    </div>
  );
}
