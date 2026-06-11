// src/components/chat/Sidebar.tsx
// Real sidebar implementation backed by Dexie via useLiveQuery.
// Replaces the WAVE-1-STUB; preserves the SidebarProps shape so
// other consumers (Chats page) keep compiling.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate }     from "react-router-dom";
import { useLiveQuery }                 from "dexie-react-hooks";
import {
  db, createChat, deleteChat, deleteNodeSubtree, renameChat, renameNode,
  type Node,
} from "../../lib/db";
import { buildTree, type TreeNode }     from "../../lib/path";
import { Glyph }                        from "../Glyph";
import { useSettings }                  from "../../hooks/useSettings";
import { useActiveStreams }             from "../../hooks/StreamsProvider";
import { anyModalOpen }                 from "../../hooks/useModalStack";
import { useSearchState }               from "../../hooks/useSearchState";
import { searchService, type ResolvedHit } from "../../lib/search/service";

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


// Connector-guide utility sets, one per guide kind. trunk = ancestor still
// has siblings below (full vertical line); tee = branch point (line + tick);
// elbow = last child (half line + tick); blank = spacer under a finished
// ancestor column.
const GUIDE_LINE = "tw:before:content-[''] tw:before:absolute tw:before:left-1/2 tw:before:-top-px tw:before:w-px tw:before:bg-line tw:before:-translate-x-[0.5px]";
const GUIDE_TICK = "tw:after:content-[''] tw:after:absolute tw:after:left-1/2 tw:after:top-1/2 tw:after:w-[7px] tw:after:h-px tw:after:bg-line";
const GUIDE: Record<string, string> = {
  trunk: `${GUIDE_LINE} tw:before:-bottom-px`,
  tee:   `${GUIDE_LINE} tw:before:-bottom-px ${GUIDE_TICK}`,
  elbow: `${GUIDE_LINE} tw:before:h-[calc(50%+1px)] ${GUIDE_TICK}`,
  blank: "",
};

const DEPTH_DOT = ["tw:bg-coral", "tw:bg-teal", "tw:bg-lilac", "tw:bg-butter"];

// ── component ─────────────────────────────────────────────────────

export function Sidebar({ activeChatId, onOpenSettings }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const { prefs, setTheme, setPref } = useSettings();
  const activeStreams = useActiveStreams();
  const onReflectionsPage = location.pathname.startsWith("/reflections");
  const onGraphsPage      = location.pathname.startsWith("/graphs");

  // Collapsed = slim icon rail. Persisted in prefs so it survives reloads and
  // is shared with the .shell grid (which owns the column width).
  const isCollapsed = prefs.sidebarCollapsed;
  const toggleCollapsed = (): void => setPref("sidebarCollapsed", !isCollapsed);

  // ⌃B / ⌘B toggles the rail (VS Code's convention). Skip while typing so the
  // composer keeps ⌘B-for-bold; mirrors the input guard in Overlays.tsx.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl || (e.key !== "b" && e.key !== "B")) return;
      const t = e.target as HTMLElement | null;
      const inField = !!t && (
        t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable
      );
      if (inField) return;
      e.preventDefault();
      setPref("sidebarCollapsed", !prefs.sidebarCollapsed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.sidebarCollapsed, setPref]);

  // ⌃N / ⌘N — new chat, as advertised in the shortcuts sheet. Skipped while
  // typing or while a modal is on top (spawning a chat under a dialog is
  // never intended).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl || (e.key !== "n" && e.key !== "N")) return;
      const t = e.target as HTMLElement | null;
      const inField = !!t && (
        t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable
      );
      if (inField || anyModalOpen()) return;
      e.preventDefault();
      void createChat("New chat").then(id => navigate(`/chat/${id}`));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const chats = useLiveQuery(
    // Graph dock chats render only inside their graph's editor.
    () => db.chats.orderBy("updatedAt").reverse().filter(c => !c.graphId).toArray(),
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
    // Skip the root row: its label mirrors the chat title (renameChat keeps
    // them in sync), so rendering it added a duplicate line + one useless
    // nesting level. The root's children ARE the top-level branches;
    // clicking the active chat row selects the root.
    const roots = buildTree(activeNodes);
    const topLevel = roots.flatMap(r => r.children);
    return flattenTree(topLevel, collapsed);
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
    // Re-clicking the ACTIVE chat returns to the root branch — the role the
    // removed duplicate root row used to play.
    if (chatId === activeChatId && activeChat) {
      void handleSelectNode(activeChat.rootNodeId);
      return;
    }
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

  // ── rename state ──────────────────────────────────────────────
  // At most one row (chat OR branch node) is in inline-edit mode at a
  // time. The target is identified by {kind,id} — chat ids and node ids
  // are both UUID strings and never collide, but the commit path differs
  // (chat → renameChat, node → renameNode), so we track the kind. A ref
  // flag guards against the Enter-then-blur double-commit (Enter fires
  // commit, which also blurs the input → onBlur would fire a second
  // commit). The flag is set on the first commit and cleared once the
  // row leaves edit mode.
  type RenameTarget = { kind: "chat" | "node"; id: string };

  const [renamingId, setRenamingId] = useState<RenameTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const committedRef = useRef(false);

  const startRename = (target: RenameTarget, currentLabel: string): void => {
    committedRef.current = false;
    setRenameDraft(currentLabel);
    setRenamingId(target);
  };

  const cancelRename = (): void => {
    committedRef.current = false;
    setRenamingId(null);
  };

  const commitRename = async (target: RenameTarget): Promise<void> => {
    if (committedRef.current) return;
    committedRef.current = true;
    const t = renameDraft.trim();
    setRenamingId(null);
    if (t) {
      if (target.kind === "chat") await renameChat(target.id, t);
      else await renameNode(target.id, t);
    }
  };

  // Chat filtering goes through the search service, so matches come from
  // full message bodies and reflections (and meaning, once the semantic
  // layer is up) — not just title substrings. Results are relevance-ranked.
  const [ranked, setRanked] = useState<{
    q: string;
    chatIds: string[];
    byChat: Map<string, ResolvedHit[]>;
  } | null>(null);
  useEffect(() => {
    const needle = search.trim();
    if (!needle) {
      setRanked(null);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void searchService.search(needle, 60).then(res => {
        if (cancelled) return;
        const chatIds: string[] = [];
        const byChat = new Map<string, ResolvedHit[]>();
        for (const h of res.hits) {
          if (!chatIds.includes(h.chatId)) chatIds.push(h.chatId);
          // Chat-title hits rank the chat but get no preview row — the
          // chat row right above already shows that title (a preview
          // repeating it read as a broken duplicate).
          if (h.kind === "chat") continue;
          const arr = byChat.get(h.chatId) ?? [];
          // Up to 3 match previews per chat keep the list scannable.
          if (arr.length < 3) arr.push(h);
          byChat.set(h.chatId, arr);
        }
        setRanked({ q: needle, chatIds, byChat });
      });
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  // Open a search preview at its exact location: the branch, and for
  // message hits the exact message — scrolled to, flashed, and with the
  // matched terms highlighted (the ?q= param drives the term highlight).
  const openSearchHit = (h: ResolvedHit): void => {
    const params = new URLSearchParams({ node: h.nodeId });
    if (h.kind === "message") {
      params.set("msg", h.rawId);
      const needle = search.trim();
      if (needle) params.set("q", needle);
    }
    navigate(`/chat/${h.chatId}?${params.toString()}`);
  };

  const visibleChats = useMemo(() => {
    if (!chats) return [];
    const needle = search.trim();
    if (!needle) return chats;
    // Ranked results once the (debounced) service answer for THIS query is
    // in; title-substring fallback while typing.
    if (ranked && ranked.q === needle) {
      const byId = new Map(chats.map(c => [c._id, c]));
      return ranked.chatIds
        .map(id => byId.get(id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
    }
    const q = needle.toLowerCase();
    return chats.filter(c => c.title.toLowerCase().includes(q));
  }, [chats, search, ranked]);

  const isDark = prefs.theme === "dark";

  return (
    <aside className="tw:bg-bg tw:border-r tw:border-line tw:flex tw:flex-col tw:min-h-0 tw:relative tw:overflow-hidden">
      <div className={`tw:flex tw:items-center tw:justify-between ${isCollapsed ? "tw:flex-col tw:gap-1.5 tw:pt-3.5 tw:px-0 tw:pb-2.5" : "tw:gap-2 tw:pt-4 tw:px-4 tw:pb-2.5"}`}>
        <a
          href="/"
          className={`tw:flex tw:items-center tw:gap-2 tw:font-display tw:font-semibold tw:text-[17px] tw:tracking-[-0.02em] tw:[&_svg]:flex-none tw:min-w-0 ${isCollapsed ? "tw:flex-none tw:justify-center" : "tw:flex-1"}`}
          title="cogninode — all chats"
          onClick={(e) => { e.preventDefault(); navigate("/"); }}
        >
          <Glyph size={22} />
          <span className={isCollapsed ? "tw:hidden" : undefined}>cogninode <span className={`tw:font-mono tw:text-[9px] tw:font-medium tw:tracking-[0.14em] tw:uppercase tw:text-coral tw:bg-coral-tint tw:px-1.5 tw:py-0.5 tw:rounded-[4px] tw:align-[2px] tw:ml-1 ${isCollapsed ? "tw:hidden" : "tw:inline-block"}`}>beta</span></span>
        </a>
        <button
          className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink"
          title="All chats"
          aria-label="All chats"
          onClick={() => navigate("/")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3"  width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="9" y="3"  width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="2" y="10" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="9" y="10" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        <button
          className={`tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] ${onReflectionsPage ? "tw:bg-lilac-tint tw:text-lilac tw:dark:bg-[color-mix(in_oklab,var(--lilac)_18%,transparent)]" : "tw:text-ink-2 tw:hover:bg-bg-2 tw:hover:text-ink"}`}
          title="Reflections"
          aria-label="Reflections"
          aria-current={onReflectionsPage ? "page" : undefined}
          onClick={() => navigate("/reflections")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M1.8 8 C4 4.7 12 4.7 14.2 8 C12 11.3 4 11.3 1.8 8 Z" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        <button
          className={`tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] ${onGraphsPage ? "tw:bg-teal-tint tw:text-teal tw:dark:bg-[color-mix(in_oklab,var(--teal)_18%,transparent)]" : "tw:text-ink-2 tw:hover:bg-bg-2 tw:hover:text-ink"}`}
          title="Knowledge graphs"
          aria-label="Knowledge graphs"
          aria-current={onGraphsPage ? "page" : undefined}
          onClick={() => navigate("/graphs")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="12.5" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="6.5" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.6 5 L11 6 M5 5.7 L6.2 10.8 M7.9 11.7 L11.3 7.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className={`tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink ${isCollapsed ? "tw:-order-1" : ""}`}
          onClick={toggleCollapsed}
          title={isCollapsed ? "Expand sidebar (⌃B)" : "Collapse sidebar (⌃B)"}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!isCollapsed}
        >
          <svg className={`tw:transition-transform tw:duration-200 tw:ease-[ease] ${isCollapsed ? "tw:[transform:scaleX(-1)]" : ""}`} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8.5 4 L4.5 8 L8.5 12 M12 4 L8 8 L12 12"
                  stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className={`tw:mx-3 tw:mt-0 tw:mb-2 tw:relative ${isCollapsed ? "tw:hidden" : ""}`}>
        <svg className="tw:absolute tw:left-[11px] tw:top-1/2 tw:[transform:translateY(-50%)] tw:text-ink-3 tw:pointer-events-none" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 10.5 L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          className="tw:w-full tw:py-[9px] tw:pr-8 tw:pl-[34px] tw:border tw:border-line tw:bg-bg-3 tw:rounded-app-sm tw:text-[13px] tw:outline-none tw:transition-[border-color] tw:duration-[120ms] tw:ease-[ease] tw:focus:border-ink-3 tw:placeholder:text-ink-3"
          type="text"
          placeholder="Search chats…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            className="tw:absolute tw:right-[7px] tw:top-1/2 tw:[transform:translateY(-50%)] tw:w-[18px] tw:h-[18px] tw:grid tw:place-items-center tw:rounded-[50%] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink"
            onClick={() => setSearch("")}
            title="Clear search"
            aria-label="Clear search"
            type="button"
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <button className={`tw:flex tw:items-center tw:gap-2 tw:bg-ink tw:text-bg tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:transition-[background-color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-[#2a2522] tw:dark:hover:bg-[color-mix(in_oklab,var(--ink)_88%,var(--bg))] ${isCollapsed ? "tw:mt-0.5 tw:mx-auto tw:mb-2 tw:w-[38px] tw:h-[38px] tw:p-0 tw:justify-center" : "tw:mx-3 tw:mt-0 tw:mb-3 tw:px-3 tw:py-2.5"}`} onClick={handleNewChat} title="New chat (⌃N)">
        <span className="tw:w-[18px] tw:h-[18px] tw:grid tw:place-items-center tw:rounded-app-xs tw:bg-[var(--veil-white-14)] tw:text-[14px] tw:leading-none">+</span>
        <span className={isCollapsed ? "tw:hidden" : undefined}>New chat</span>
        <span className={`tw:ml-auto tw:font-mono tw:text-[10px] tw:bg-[var(--veil-white-14)] tw:px-1.5 tw:py-0.5 tw:rounded-[4px] tw:text-[var(--veil-white-80)] ${isCollapsed ? "tw:hidden" : ""}`}>⌃N</span>
      </button>

      <div className={`tw:font-mono tw:text-[10px] tw:tracking-[0.14em] tw:uppercase tw:text-ink-3 tw:pt-2.5 tw:px-[18px] tw:pb-1.5 ${isCollapsed ? "tw:hidden" : ""}`}>Recent chats</div>

      <div className={`side-list tw:flex-1 tw:overflow-y-auto tw:pt-0 tw:px-2 tw:pb-2 tw:[scrollbar-width:thin] tw:[scrollbar-color:var(--line)_transparent] ${isCollapsed ? "tw:hidden" : ""}`}>
        {visibleChats.map(chat => {
          const isActive = chat._id === activeChatId;
          const isPending = pending?.kind === "chat" && pending.id === chat._id;
          const isRenaming = renamingId?.kind === "chat" && renamingId.id === chat._id;
          const hitPreviews =
            search.trim() && ranked && ranked.q === search.trim()
              ? ranked.byChat.get(chat._id)
              : undefined;
          return (
            <div key={chat._id}>
              <div
                className={`tw:group/row tw:flex tw:items-center tw:gap-2 tw:px-2.5 tw:py-[7px] tw:rounded-[8px] tw:text-[13px] tw:cursor-pointer tw:relative tw:transition-[background-color,color] tw:duration-100 tw:ease-[ease] ${isActive ? "tw:bg-ink tw:text-bg" : "tw:text-ink-2 tw:hover:bg-bg-2 tw:hover:text-ink"}`}
                onClick={() => { if (!isRenaming) handleSelectChat(chat._id); }}
              >
                {isRenaming ? (
                  <input
                    className="tw:flex-1 tw:min-w-0 tw:text-[13px] tw:text-ink tw:bg-bg tw:border tw:border-line tw:rounded-[5px] tw:px-1.5 tw:py-0.5 tw:outline-none tw:transition-[border-color,box-shadow] tw:duration-[120ms] tw:ease-[ease] tw:focus:border-lilac tw:focus:shadow-[0_0_0_2px_color-mix(in_oklab,var(--lilac)_22%,transparent)]"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        void commitRename({ kind: "chat", id: chat._id });
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        cancelRename();
                      }
                    }}
                    onBlur={() => { void commitRename({ kind: "chat", id: chat._id }); }}
                  />
                ) : (
                  <span className="tw:flex-1 tw:truncate">{chat.title || "Untitled"}</span>
                )}
                {!isRenaming && (
                  <span className={`tw:font-mono tw:text-[10px] tw:px-1.5 tw:py-px tw:rounded-[999px] tw:flex-none ${isActive ? "tw:bg-[var(--veil-white-14)] tw:text-[color-mix(in_oklab,var(--bg)_80%,transparent)]" : "tw:text-ink-3 tw:bg-bg-2"}`}>{relativeTime(chat.updatedAt)}</span>
                )}
                {!isRenaming && (
                  <button
                    className={`tw:opacity-0 tw:w-[22px] tw:h-[22px] tw:inline-grid tw:place-items-center tw:rounded-[6px] tw:flex-none tw:transition-[opacity,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:group-hover/row:opacity-85 tw:focus-visible:opacity-85 tw:ml-1 ${isActive ? "tw:text-[color-mix(in_oklab,var(--bg)_75%,transparent)] tw:hover:bg-[color-mix(in_oklab,var(--lilac)_30%,transparent)] tw:hover:text-bg" : "tw:text-ink-3 tw:hover:bg-[color-mix(in_oklab,var(--lilac)_18%,transparent)] tw:hover:text-lilac"}`}
                    title="Rename chat"
                    aria-label="Rename chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename({ kind: "chat", id: chat._id }, chat.title || "");
                    }}
                  >
                    <PencilIcon />
                  </button>
                )}
                {!isRenaming && (
                  <button
                    className={`tw:opacity-0 tw:w-[22px] tw:h-[22px] tw:inline-grid tw:place-items-center tw:rounded-[6px] tw:flex-none tw:transition-[opacity,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:group-hover/row:opacity-85 tw:focus-visible:opacity-85 tw:ml-1 ${isActive ? "tw:text-[color-mix(in_oklab,var(--bg)_75%,transparent)] tw:hover:bg-[color-mix(in_oklab,var(--coral)_26%,transparent)] tw:hover:text-bg" : "tw:text-ink-3 tw:hover:bg-[color-mix(in_oklab,var(--coral)_18%,transparent)] tw:hover:text-coral"}`}
                    title="Delete chat"
                    aria-label="Delete chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      armConfirm({ kind: "chat", id: chat._id });
                    }}
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>

              {isPending && (
                <ConfirmPill
                  label="Delete this chat?"
                  onConfirm={() => { void confirmDeleteChat(chat._id); }}
                  onCancel={cancelConfirm}
                />
              )}

              {/* While searching: matched-text previews under the chat —
                  click lands on the exact branch/message. */}
              {hitPreviews && hitPreviews.length > 0 && (
                <div className="tw:mt-0.5 tw:mb-1.5 tw:ml-[22px] tw:flex tw:flex-col">
                  {hitPreviews.map(h => (
                    <button
                      key={h.docId}
                      className="tw:flex tw:items-start tw:gap-1.5 tw:text-left tw:py-1 tw:px-2 tw:rounded-[6px] tw:text-[11.5px] tw:text-ink-3 tw:cursor-pointer tw:hover:bg-bg-2 tw:hover:text-ink"
                      onClick={(e) => { e.stopPropagation(); openSearchHit(h); }}
                      title={h.snippet?.text || h.title}
                      type="button"
                    >
                      <svg className="tw:flex-none tw:mt-[2px] tw:opacity-70" width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                      <span className="tw:flex-1 tw:min-w-0 tw:truncate">
                        {h.snippet?.text || h.title || "match"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {isActive && !search.trim() && branchRows.length > 0 && (
                <div className="tw:mt-0.5 tw:mb-1.5 tw:ml-[22px] tw:flex tw:flex-col tw:gap-0">
                  {branchRows.map(row => {
                    const rowActive = activeChat?.currentNodeId === row.node._id;
                    const isRoot    = row.node._id === activeChat?.rootNodeId;
                    const isRowPending = pending?.kind === "branch" && pending.id === row.node._id;
                    const isRowRenaming =
                      renamingId?.kind === "node" && renamingId.id === row.node._id;
                    return (
                      <div key={row.node._id}>
                        <div
                          className={`tw:group/row tw:flex tw:items-stretch tw:gap-1.5 tw:pl-0 tw:pr-2 tw:min-h-[26px] tw:rounded-[6px] tw:text-[12px] tw:cursor-pointer tw:relative ${rowActive ? "tw:bg-coral-tint tw:text-ink tw:font-medium" : "tw:text-ink-2 tw:hover:bg-bg-2 tw:hover:text-ink"}`}
                          data-depth={Math.min(3, row.node.depth)}
                          onClick={() => {
                            if (!isRowRenaming) void handleSelectNode(row.node._id);
                          }}
                        >
                          {row.lastFlags.length > 0 && (
                            <div className="tw:flex tw:self-stretch tw:flex-none">
                              {row.lastFlags.map((isLast, i) => {
                                const isElbow = i === row.lastFlags.length - 1;
                                const cls = isElbow
                                  ? (isLast ? "elbow" : "tee")
                                  : (isLast ? "blank" : "trunk");
                                return <span key={i} className={`tw:w-3.5 tw:flex-none tw:relative ${GUIDE[cls]}`} />;
                              })}
                            </div>
                          )}
                          {row.hasChildren ? (
                            <button
                              className={`tw:self-center tw:w-4 tw:h-4 tw:grid tw:place-items-center tw:flex-none tw:bg-transparent tw:border-0 tw:p-0 tw:rounded-[4px] tw:text-ink-3 tw:cursor-pointer tw:transition-[transform,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-[rgba(0,0,0,0.06)] tw:hover:text-ink ${!row.isCollapsed ? "tw:[transform:rotate(90deg)]" : ""}`}
                              onClick={(e) => { e.stopPropagation(); toggleNode(row.node._id); }}
                              title={row.isCollapsed ? "Expand" : "Collapse"}
                            >
                              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                <path d="M3 2 L7 5 L3 8" stroke="currentColor" strokeWidth="1.6"
                                      strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          ) : (
                            <span className="tw:w-4 tw:flex-none" />
                          )}
                          <span className={`tw:w-2 tw:h-2 tw:rounded-[50%] tw:flex-none tw:self-center ${DEPTH_DOT[Math.min(3, row.node.depth)]}`} />
                          {isRowRenaming ? (
                            <input
                              className="tw:flex-1 tw:min-w-0 tw:text-[13px] tw:text-ink tw:bg-bg tw:border tw:border-line tw:rounded-[5px] tw:px-1.5 tw:py-0.5 tw:outline-none tw:transition-[border-color,box-shadow] tw:duration-[120ms] tw:ease-[ease] tw:focus:border-lilac tw:focus:shadow-[0_0_0_2px_color-mix(in_oklab,var(--lilac)_22%,transparent)]"
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              autoFocus
                              onFocus={(e) => e.currentTarget.select()}
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void commitRename({ kind: "node", id: row.node._id });
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  cancelRename();
                                }
                              }}
                              onBlur={() => {
                                void commitRename({ kind: "node", id: row.node._id });
                              }}
                            />
                          ) : (
                            <span className="tw:flex-[1_1_auto] tw:min-w-0 tw:truncate tw:self-center tw:py-[5px] tw:px-0">{row.node.label || "(no label)"}</span>
                          )}
                          {!isRowRenaming && activeStreams.has(row.node._id) && (
                            <span
                              className="b-stream-pulse"
                              aria-label="streaming"
                              title="Streaming…"
                            />
                          )}
                          {!isRowRenaming && (
                            <button
                              className={`tw:opacity-0 tw:w-[22px] tw:h-[22px] tw:inline-grid tw:place-items-center tw:rounded-[6px] tw:flex-none tw:transition-[opacity,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:group-hover/row:opacity-85 tw:focus-visible:opacity-85 tw:ml-auto ${rowActive ? "tw:text-ink tw:hover:bg-[color-mix(in_oklab,var(--lilac)_18%,transparent)] tw:hover:text-lilac" : "tw:text-ink-3 tw:hover:bg-[color-mix(in_oklab,var(--lilac)_18%,transparent)] tw:hover:text-lilac"}`}
                              title={isRoot ? "Rename chat" : "Rename branch"}
                              aria-label={isRoot ? "Rename chat" : "Rename branch"}
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(
                                  { kind: "node", id: row.node._id },
                                  row.node.label || "",
                                );
                              }}
                            >
                              <PencilIcon />
                            </button>
                          )}
                          {!isRowRenaming && (
                            <button
                              className={`tw:opacity-0 tw:w-[22px] tw:h-[22px] tw:inline-grid tw:place-items-center tw:rounded-[6px] tw:flex-none tw:transition-[opacity,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:group-hover/row:opacity-85 tw:focus-visible:opacity-85 tw:ml-1 tw:text-ink-3 tw:hover:bg-[color-mix(in_oklab,var(--coral)_18%,transparent)] tw:hover:text-coral`}
                              title={isRoot ? "Delete chat" : "Delete branch"}
                              aria-label={isRoot ? "Delete chat" : "Delete branch"}
                              onClick={(e) => {
                                e.stopPropagation();
                                armConfirm({ kind: "branch", id: row.node._id });
                              }}
                            >
                              <TrashIcon />
                            </button>
                          )}
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
          <div className="tw:py-5 tw:px-3 tw:text-ink-3 tw:text-[13px] tw:text-center">
            {search ? `No chats match "${search}"` : "No chats yet — start one above."}
          </div>
        )}
      </div>

      <SearchStatusStrip collapsed={isCollapsed} onOpenSettings={onOpenSettings} />

      <div className={`tw:border-t tw:border-line tw:flex tw:items-center tw:relative ${isCollapsed ? "tw:flex-col tw:gap-1 tw:py-2.5 tw:px-0 tw:mt-auto" : "tw:gap-2.5 tw:p-3"}`}>
        <div className={`tw:w-[34px] tw:h-[34px] tw:rounded-[50%] tw:text-bg tw:grid tw:place-items-center tw:font-display tw:font-semibold tw:text-[14px] tw:flex-none tw:bg-bg-2 tw:border tw:border-line tw:dark:bg-bg-3 ${isCollapsed ? "tw:hidden" : ""}`} title="cogninode beta">
          <Glyph size={20} color="var(--ink)" accent="var(--coral)" />
        </div>
        <div className={`tw:flex-1 tw:min-w-0 tw:flex tw:flex-col ${isCollapsed ? "tw:hidden" : ""}`}>
          <span className="tw:text-[13px] tw:font-medium tw:text-ink tw:truncate">cogninode</span>
          <span className="tw:font-mono tw:text-[10px] tw:text-ink-3 tw:flex tw:items-center tw:gap-1 tw:min-w-0">
            <span className="tw:w-1.5 tw:h-1.5 tw:rounded-[50%] tw:flex-none" style={{ background: "var(--teal)" }} />
            local
            <SearchStatusChip />
          </span>
        </div>
        <button
          className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink tw:[&_svg]:w-3.5 tw:[&_svg]:h-3.5 tw:hover:[transform:rotate(-12deg)]"
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
        <button className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink" onClick={onOpenSettings} title="Settings (⌃,)">
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

// Quiet "hybrid" badge once semantic search is READY — short enough to
// never truncate in the cramped footer line. While the model downloads /
// indexes (or fails), the full-width SearchStatusStrip above the footer
// takes over.
function SearchStatusChip() {
  const s = useSearchState();
  const { prefs } = useSettings();
  if (!prefs.semanticSearch || s.semantic !== "ready") return null;
  return (
    <span
      className="tw:inline-flex tw:items-center tw:gap-1 tw:flex-none tw:font-mono tw:text-[10px] tw:text-ink-3"
      title={`Hybrid search ready · ${s.vectorCount} items embedded`}
    >
      <span aria-hidden="true">·</span>
      <span className="tw:w-1.5 tw:h-1.5 tw:rounded-[50%] tw:flex-none" style={{ background: "var(--teal)" }} />
      hybrid
    </span>
  );
}

// Full-width status strip pinned above the footer while the semantic layer
// is busy (download / indexing, with a progress bar) or broken (with an
// inline retry). Hidden when ready/off so it costs no space at rest.
function SearchStatusStrip({ collapsed, onOpenSettings }: { collapsed: boolean; onOpenSettings: () => void }) {
  const s = useSearchState();
  const { prefs } = useSettings();
  if (!prefs.semanticSearch) return null;

  const active = s.semantic === "starting" || s.semantic === "downloading" || s.semantic === "indexing";
  const failed = s.semantic === "error";
  if (!active && !failed) return null;

  const label =
    s.semantic === "starting"    ? "semantic search: preparing…" :
    s.semantic === "downloading" ? `downloading model · ${s.downloadPct}%` :
    s.semantic === "indexing"    ? `indexing messages · ${s.indexed}/${s.indexTotal}` :
    "semantic search failed";

  if (collapsed) {
    return (
      <div className="tw:grid tw:place-items-center tw:py-1.5" title={failed ? (s.error ?? label) : label}>
        <span className={`tw:w-2 tw:h-2 tw:rounded-[50%] ${failed ? "tw:bg-coral" : "tw:bg-butter tw:animate-pulse"}`} />
      </div>
    );
  }

  const pct =
    s.semantic === "downloading" ? s.downloadPct :
    s.semantic === "indexing" && s.indexTotal > 0
      ? Math.round((s.indexed / s.indexTotal) * 100)
      : null;
  const barColor = s.semantic === "downloading" ? "var(--lilac)" : "var(--butter)";

  return (
    <div className="tw:mx-3 tw:mb-2 tw:py-2 tw:px-2.5 tw:rounded-[10px] tw:border tw:border-line tw:bg-bg-3 tw:flex tw:flex-col tw:gap-1.5">
      <div className="tw:flex tw:items-center tw:gap-1.5 tw:font-mono tw:text-[10px] tw:min-w-0">
        <span
          className={`tw:w-1.5 tw:h-1.5 tw:rounded-[50%] tw:flex-none ${!failed ? "tw:animate-pulse" : ""}`}
          style={{ background: failed ? "var(--coral)" : barColor }}
        />
        <button
          className={`tw:truncate tw:p-0 tw:text-left ${failed ? "tw:text-coral tw:cursor-pointer tw:hover:underline" : "tw:text-ink-2 tw:cursor-default"}`}
          onClick={failed ? onOpenSettings : undefined}
          title={failed ? `${s.error ?? label} — click for Settings` : label}
          type="button"
        >
          {label}
        </button>
        {failed && (
          <button
            className="tw:ml-auto tw:flex-none tw:text-ink-2 tw:underline tw:p-0 tw:hover:text-ink"
            onClick={() => void searchService.retrySemantic()}
            type="button"
          >
            retry
          </button>
        )}
      </div>
      {pct !== null && (
        <div className="tw:h-1 tw:rounded-[999px] tw:bg-bg-2 tw:overflow-hidden">
          <div
            className="tw:h-full tw:rounded-[999px] tw:transition-[width] tw:duration-300 tw:ease-out"
            style={{ width: `${pct}%`, background: barColor }}
          />
        </div>
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11 2.5 L13.5 5 M10 3.5 L3.5 10 L3 13 L6 12.5 L12.5 6"
            stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
      className="tw:flex tw:items-center tw:gap-1.5 tw:mt-1 tw:mx-2.5 tw:mb-1.5 tw:px-2.5 tw:py-1.5 tw:bg-[color-mix(in_oklab,var(--coral)_12%,var(--bg-3))] tw:border tw:border-[color-mix(in_oklab,var(--coral)_30%,var(--line))] tw:rounded-[8px] tw:text-[12px] tw:text-ink"
      style={indent > 0 ? { marginLeft: 12 + indent * 14 } : undefined}
    >
      <span className="tw:flex-1 tw:min-w-0">{label}</span>
      <button
        className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:transition-[background-color,color] tw:duration-100 tw:ease-[ease] tw:text-coral tw:font-semibold tw:hover:bg-coral tw:hover:text-white"
        onClick={(e) => { e.stopPropagation(); onConfirm(); }}
      >
        yes
      </button>
      <span className="tw:text-ink-4">·</span>
      <button
        className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:transition-[background-color,color] tw:duration-100 tw:ease-[ease] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
      >
        cancel
      </button>
    </div>
  );
}
