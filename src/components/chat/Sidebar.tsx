// src/components/chat/Sidebar.tsx
// Real sidebar implementation backed by Dexie via useLiveQuery.
// Replaces the WAVE-1-STUB; preserves the SidebarProps shape so
// other consumers (Chats page) keep compiling.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate }                  from "react-router-dom";
import { useLiveQuery }                 from "dexie-react-hooks";
import {
  db, createChat, deleteChat, deleteNodeSubtree, type Node,
} from "../../lib/db";
import { buildTree, type TreeNode }     from "../../lib/path";
import { Glyph }                        from "../Glyph";
import { useSettings }                  from "../../hooks/useSettings";

export interface SidebarProps {
  activeChatId:   string | null;
  onOpenSettings: () => void;
}

// ── helpers ───────────────────────────────────────────────────────

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min  = Math.floor(diff / 60_000);
  if (min < 1)       return "just now";
  if (min < 60)      return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)       return `${hr}h ago`;
  const d  = Math.floor(hr / 24);
  if (d < 7)         return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const COLLAPSE_KEY = (chatId: string) => `cogninode_sidebar_collapsed_${chatId}`;

function loadCollapsed(chatId: string): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY(chatId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsed(chatId: string, collapsed: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY(chatId), JSON.stringify([...collapsed]));
  } catch {
    /* ignore */
  }
}

// Flat row representation produced by DFS-walking the node tree.
interface BranchRow {
  node:        Node;
  depth:       number;
  hasChildren: boolean;
  isCollapsed: boolean;
  /** Total count of descendants under this node (excluding self). */
  descendantCount: number;
  // Per-ancestor "is last child" flags, used to draw connector guides.
  lastFlags:   boolean[];
}

function flattenTree(
  trees:     TreeNode[],
  collapsed: Set<string>,
): BranchRow[] {
  const out: BranchRow[] = [];
  const countDescendants = (tn: TreeNode): number => {
    let n = 0;
    for (const c of tn.children) n += 1 + countDescendants(c);
    return n;
  };
  const visit = (tn: TreeNode, depth: number, lastFlags: boolean[]): void => {
    const hasChildren = tn.children.length > 0;
    const isCollapsed = collapsed.has(tn.node._id);
    out.push({
      node: tn.node,
      depth,
      hasChildren,
      isCollapsed,
      descendantCount: countDescendants(tn),
      lastFlags,
    });
    if (hasChildren && !isCollapsed) {
      tn.children.forEach((child, i) => {
        visit(child, depth + 1, [...lastFlags, i === tn.children.length - 1]);
      });
    }
  };
  trees.forEach(root => visit(root, 0, []));
  return out;
}

// ── component ─────────────────────────────────────────────────────

export function Sidebar({ activeChatId, onOpenSettings }: SidebarProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { prefs, setTheme } = useSettings();

  const chats = useLiveQuery(
    () => db.chats.orderBy("updatedAt").reverse().toArray(),
    [],
  );

  // For the active chat: read its nodes and currentNodeId so we can render
  // and highlight the branch tree below the active row.
  const activeChat = useLiveQuery(
    () => activeChatId ? db.chats.get(activeChatId) : undefined,
    [activeChatId],
  );
  const activeNodes = useLiveQuery(
    () => activeChatId
      ? db.nodes.where("chatId").equals(activeChatId).toArray()
      : [],
    [activeChatId],
  ) ?? [];

  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    activeChatId ? loadCollapsed(activeChatId) : new Set(),
  );

  // Reload collapse state whenever the active chat changes.
  useEffect(() => {
    setCollapsed(activeChatId ? loadCollapsed(activeChatId) : new Set());
  }, [activeChatId]);

  const branchRows = useMemo(() => {
    if (!activeChatId) return [];
    return flattenTree(buildTree(activeNodes), collapsed);
  }, [activeChatId, activeNodes, collapsed]);

  const toggleNode = (nodeId: string): void => {
    if (!activeChatId) return;
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      saveCollapsed(activeChatId, next);
      return next;
    });
  };

  const handleNewChat = async (): Promise<void> => {
    const id = await createChat("New chat");
    navigate(`/chat/${id}`);
  };

  const handleSelectChat = (chatId: string): void => {
    navigate(`/chat/${chatId}`);
  };

  const handleSelectNode = async (nodeId: string): Promise<void> => {
    if (!activeChatId) return;
    await db.chats.update(activeChatId, { currentNodeId: nodeId });
  };

  // ── delete state ──────────────────────────────────────────────
  // We track at most one in-flight confirm at a time, identified by
  // its kind + id. Auto-reverts after 4s.
  type Pending =
    | { kind: "chat";   id: string }
    | { kind: "branch"; id: string };

  const [pending, setPending] = useState<Pending | null>(null);
  const revertTimer = useRef<number | null>(null);

  const armConfirm = (next: Pending): void => {
    setPending(next);
    if (revertTimer.current !== null) window.clearTimeout(revertTimer.current);
    revertTimer.current = window.setTimeout(() => {
      setPending(null);
      revertTimer.current = null;
    }, 4000);
  };

  const cancelConfirm = (): void => {
    if (revertTimer.current !== null) {
      window.clearTimeout(revertTimer.current);
      revertTimer.current = null;
    }
    setPending(null);
  };

  useEffect(() => {
    return () => {
      if (revertTimer.current !== null) window.clearTimeout(revertTimer.current);
    };
  }, []);

  const confirmDeleteChat = async (chatId: string): Promise<void> => {
    cancelConfirm();
    await deleteChat(chatId);
    if (chatId === activeChatId) navigate("/");
  };

  const confirmDeleteBranch = async (nodeId: string): Promise<void> => {
    if (!activeChatId || !activeChat) return;
    // If this is the root, delegate to chat-level delete.
    if (nodeId === activeChat.rootNodeId) {
      await confirmDeleteChat(activeChatId);
      return;
    }
    cancelConfirm();
    await deleteNodeSubtree(activeChatId, nodeId);
  };

  const visibleChats = useMemo(() => {
    if (!chats) return [];
    if (!search.trim()) return chats;
    const q = search.trim().toLowerCase();
    return chats.filter(c => c.title.toLowerCase().includes(q));
  }, [chats, search]);

  const isDark = prefs.theme === "dark";

  return (
    <aside className="side">
      <div className="side-top">
        <a
          href="/"
          className="side-brand"
          onClick={(e) => { e.preventDefault(); navigate("/"); }}
        >
          <Glyph size={22} />
          <span>cogninode <span className="beta-tag">beta</span></span>
        </a>
        <button
          className="icon-btn"
          title="All chats"
          onClick={() => navigate("/")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3"  width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="9" y="3"  width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="2" y="10" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="9" y="10" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>

      <div className="side-search">
        <svg className="s-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 10.5 L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          placeholder="Search chats…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <button className="side-new" onClick={handleNewChat}>
        <span className="plus">+</span>
        New chat
        <span className="kbd">⌃N</span>
      </button>

      <div className="side-section-h">Recent chats</div>

      <div className="side-list">
        {visibleChats.map(chat => {
          const isActive = chat._id === activeChatId;
          const isPending = pending?.kind === "chat" && pending.id === chat._id;
          return (
            <div key={chat._id}>
              <div
                className={`chat-row ${isActive ? "active expanded" : ""} has-delete`}
                onClick={() => handleSelectChat(chat._id)}
              >
                <span className="c-label">{chat.title || "Untitled"}</span>
                <span className="c-count">{relativeTime(chat.updatedAt)}</span>
                <button
                  className="row-del"
                  title="Delete chat"
                  aria-label="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    armConfirm({ kind: "chat", id: chat._id });
                  }}
                >
                  <TrashIcon />
                </button>
              </div>

              {isPending && (
                <ConfirmPill
                  label="Delete this chat?"
                  onConfirm={() => { void confirmDeleteChat(chat._id); }}
                  onCancel={cancelConfirm}
                />
              )}

              {isActive && branchRows.length > 0 && (
                <div className="branch-list">
                  {branchRows.map(row => {
                    const rowActive = activeChat?.currentNodeId === row.node._id;
                    const isRoot    = row.node._id === activeChat?.rootNodeId;
                    const isRowPending = pending?.kind === "branch" && pending.id === row.node._id;
                    return (
                      <div key={row.node._id}>
                        <div
                          className={`branch-row ${rowActive ? "active" : ""} has-delete`}
                          data-depth={Math.min(3, row.depth)}
                          onClick={() => void handleSelectNode(row.node._id)}
                        >
                          {row.lastFlags.length > 0 && (
                            <div className="b-guides">
                              {row.lastFlags.map((isLast, i) => {
                                const isElbow = i === row.lastFlags.length - 1;
                                const cls = isElbow
                                  ? (isLast ? "elbow" : "tee")
                                  : (isLast ? "blank" : "trunk");
                                return <span key={i} className={`bg ${cls}`} />;
                              })}
                            </div>
                          )}
                          {row.hasChildren ? (
                            <button
                              className={`b-chev ${!row.isCollapsed ? "open" : ""}`}
                              onClick={(e) => { e.stopPropagation(); toggleNode(row.node._id); }}
                              title={row.isCollapsed ? "Expand" : "Collapse"}
                            >
                              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                <path d="M3 2 L7 5 L3 8" stroke="currentColor" strokeWidth="1.6"
                                      strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          ) : (
                            <span className="b-chev-spacer" />
                          )}
                          <span className="b-dot" />
                          <span className="b-label">{row.node.label || "(no label)"}</span>
                          <button
                            className="row-del row-del-branch"
                            title={isRoot ? "Delete chat" : "Delete branch"}
                            aria-label={isRoot ? "Delete chat" : "Delete branch"}
                            onClick={(e) => {
                              e.stopPropagation();
                              armConfirm({ kind: "branch", id: row.node._id });
                            }}
                          >
                            <TrashIcon />
                          </button>
                        </div>

                        {isRowPending && (
                          <ConfirmPill
                            label={
                              isRoot
                                ? `Delete this chat? ${branchRows.length} branches.`
                                : row.descendantCount > 0
                                  ? `Delete this branch and ${row.descendantCount} descendant ${row.descendantCount === 1 ? "branch" : "branches"}?`
                                  : "Delete this branch?"
                            }
                            onConfirm={() => { void confirmDeleteBranch(row.node._id); }}
                            onCancel={cancelConfirm}
                            indent={row.depth + 1}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {visibleChats.length === 0 && (
          <div style={{ padding: "20px 12px", color: "var(--ink-3)", fontSize: 13, textAlign: "center" }}>
            {search ? `No chats match "${search}"` : "No chats yet — start one above."}
          </div>
        )}
      </div>

      <div className="side-foot">
        <div className="avatar key-avatar" title="cogninode beta">
          <Glyph size={20} color="var(--ink)" accent="var(--coral)" />
        </div>
        <div className="who">
          <span className="name">cogninode</span>
          <span className="credits">
            <span className="cred-dot" style={{ background: "var(--teal)" }} />
            local
          </span>
        </div>
        <button
          className="icon-btn theme-toggle-inline"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? (
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="3" fill="currentColor" />
              <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 1.5 V3" /><path d="M8 13 V14.5" />
                <path d="M1.5 8 H3" /><path d="M13 8 H14.5" />
                <path d="M3.2 3.2 L4.3 4.3" /><path d="M11.7 11.7 L12.8 12.8" />
                <path d="M3.2 12.8 L4.3 11.7" /><path d="M11.7 4.3 L12.8 3.2" />
              </g>
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M13.5 9.5 A6 6 0 1 1 6.5 2.5 A4.5 4.5 0 0 0 13.5 9.5 Z"
                    fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <button className="icon-btn" onClick={onOpenSettings} title="Settings (⌃,)">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M2.5 4 H13.5 M2.5 8 H13.5 M2.5 12 H13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="10"  cy="4"  r="1.8" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="5.5" cy="8"  r="1.8" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="11"  cy="12" r="1.8" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;

// ── small inline pieces ───────────────────────────────────────────

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4 H13 M6 4 V3 a1 1 0 0 1 1 -1 h2 a1 1 0 0 1 1 1 V4 M5 4 v9 a1 1 0 0 0 1 1 h4 a1 1 0 0 0 1 -1 V4"
            stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 7 V11 M9 7 V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

interface ConfirmPillProps {
  label:     string;
  onConfirm: () => void;
  onCancel:  () => void;
  /** Optional indent (px-ish, multiplied by depth) for nested branch rows. */
  indent?:   number;
}

function ConfirmPill({ label, onConfirm, onCancel, indent = 0 }: ConfirmPillProps) {
  return (
    <div
      className="confirm-pill"
      style={indent > 0 ? { marginLeft: 12 + indent * 14 } : undefined}
    >
      <span className="cp-label">{label}</span>
      <button
        className="cp-yes"
        onClick={(e) => { e.stopPropagation(); onConfirm(); }}
      >
        yes
      </button>
      <span className="cp-sep">·</span>
      <button
        className="cp-no"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
      >
        cancel
      </button>
    </div>
  );
}
