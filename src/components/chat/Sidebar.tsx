// src/components/chat/Sidebar.tsx
// Real sidebar implementation backed by Dexie via useLiveQuery.
// Replaces the WAVE-1-STUB; preserves the SidebarProps shape so
// other consumers (Chats page) keep compiling.

import { useEffect, useMemo, useState } from "react";
import { useNavigate }                  from "react-router-dom";
import { useLiveQuery }                 from "dexie-react-hooks";
import { db, createChat, type Node }    from "../../lib/db";
import { buildTree, type TreeNode }     from "../../lib/path";
import { Glyph }                        from "../Glyph";

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
  // Per-ancestor "is last child" flags, used to draw connector guides.
  lastFlags:   boolean[];
}

function flattenTree(
  trees:     TreeNode[],
  collapsed: Set<string>,
): BranchRow[] {
  const out: BranchRow[] = [];
  const visit = (tn: TreeNode, depth: number, lastFlags: boolean[]): void => {
    const hasChildren = tn.children.length > 0;
    const isCollapsed = collapsed.has(tn.node._id);
    out.push({ node: tn.node, depth, hasChildren, isCollapsed, lastFlags });
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

  const visibleChats = useMemo(() => {
    if (!chats) return [];
    if (!search.trim()) return chats;
    const q = search.trim().toLowerCase();
    return chats.filter(c => c.title.toLowerCase().includes(q));
  }, [chats, search]);

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
          return (
            <div key={chat._id}>
              <div
                className={`chat-row ${isActive ? "active expanded" : ""}`}
                onClick={() => handleSelectChat(chat._id)}
              >
                <span className="c-label">{chat.title || "Untitled"}</span>
                <span className="c-count">{relativeTime(chat.updatedAt)}</span>
              </div>

              {isActive && branchRows.length > 0 && (
                <div className="branch-list">
                  {branchRows.map(row => {
                    const rowActive = activeChat?.currentNodeId === row.node._id;
                    return (
                      <div
                        key={row.node._id}
                        className={`branch-row ${rowActive ? "active" : ""}`}
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
