// src/components/chat/Overlays.tsx
// QuickJump (Ctrl+Q / Cmd+K), TreeMap (Ctrl+T), Shortcuts cheat sheet (Ctrl+/).
// Self-managed: installs a single global keydown listener and renders three modal
// overlays gated by local state. Consumer is ChatApp.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type Chat, type Node } from "../../lib/db";
import { buildTree, layoutTree, findPath } from "../../lib/path";
import { getNodeMRU } from "../../lib/nodeHistory";
import { anyModalOpen, useModalBehavior } from "../../hooks/useModalStack";

export interface OverlaysProps {
  chatId: string;
  currentNodeId: string;
}

type OverlayKind = "quickjump" | "treemap" | "shortcuts" | null;

export function Overlays({ chatId, currentNodeId }: OverlaysProps) {
  const [open, setOpen] = useState<OverlayKind>(null);
  const close = useCallback(() => setOpen(null), []);

  // Single global keydown listener — gates the overlays and dispatches Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ignore keystrokes while typing in an input/textarea/contenteditable
      // so the shortcuts don't hijack normal text entry. Modifiers still
      // pass through for QuickJump/TreeMap/Shortcuts.
      const t = e.target as HTMLElement | null;
      const inField = !!t && (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      );
      if (inField && !ctrl) return;

      // Stand down while a foreign modal (Settings, save dialog, …) is on
      // top — toggling an overlay underneath it is never what the user
      // meant. Our own overlays still toggle/swap freely. Esc is handled
      // per-overlay by useModalBehavior (topmost layer only), not here.
      if (anyModalOpen() && open === null) return;

      // Ctrl+Q → QuickJump (⌘K belongs to the global SearchOverlay now)
      if (ctrl && (e.key === "q" || e.key === "Q")) {
        e.preventDefault();
        setOpen(prev => (prev === "quickjump" ? null : "quickjump"));
        return;
      }
      // Ctrl+T → TreeMap
      if (ctrl && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setOpen(prev => (prev === "treemap" ? null : "treemap"));
        return;
      }
      // Ctrl+/ → Shortcuts cheat sheet (also accepts Ctrl+? for Shift+/ layouts)
      if (ctrl && (e.key === "/" || e.key === "?")) {
        e.preventDefault();
        setOpen(prev => (prev === "shortcuts" ? null : "shortcuts"));
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open === "quickjump" && <QuickJump chatId={chatId} currentNodeId={currentNodeId} onClose={close} />}
      {open === "treemap"   && <TreeMap chatId={chatId} currentNodeId={currentNodeId} onClose={close} />}
      {open === "shortcuts" && <Shortcuts onClose={close} />}
    </>
  );
}

export default Overlays;


// depth → accent colour maps (root, L1, L2, L3+)
const QJ_DOT = ["tw:bg-coral", "tw:bg-teal", "tw:bg-lilac", "tw:bg-butter"];
const TN_BORDER = ["tw:border-coral", "tw:border-teal", "tw:border-lilac", "tw:border-butter"];
const TN_DOT = QJ_DOT;

// ── QuickJump ────────────────────────────────────────────────────────────────
// An MRU ("Alt+Tab") branch (node) switcher spanning every chat. With an empty
// search box the node the user just switched FROM is at index 0 and
// pre-selected, so Ctrl+Q then Enter toggles back to it. Below it: every other
// visited node in most-recently-visited order, then never-visited nodes by
// createdAt descending (newest branches first).

interface QuickJumpRow {
  node:    Node;
  chat:    Chat;
  visited: boolean;
  isRoot:  boolean;
}

/** Relative-time label for a past timestamp, e.g. "3m ago", "2d ago". */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.floor(mon / 12)}y ago`;
}

function QuickJump({
  chatId,
  currentNodeId,
  onClose,
}: {
  chatId:        string;
  currentNodeId: string;
  onClose:       () => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc-to-close (topmost layer only), focus restore, Tab containment.
  useModalBehavior(true, onClose, panelRef);

  const nodes = useLiveQuery<Node[], Node[]>(() => db.nodes.toArray(), [], []);
  const chats = useLiveQuery<Chat[], Chat[]>(() => db.chats.toArray(), [], []);

  // Snapshot the MRU once when the overlay mounts — it must not reorder
  // mid-session as ChatApp records the very node we may jump to.
  const mru = useMemo(() => getNodeMRU(), []);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setHi(0); }, [q]);

  // The ordered switcher list (the node currently on is excluded):
  //   1. MRU nodes in most-recently-visited order — index 0 is the
  //      just-switched-from node, which we pre-select.
  //   2. Never-visited nodes by createdAt descending (newest branches first).
  const ordered: QuickJumpRow[] = useMemo(() => {
    const nodeList = nodes ?? [];
    const chatList = chats ?? [];
    const nodeById = new Map(nodeList.map(n => [n._id, n]));
    const chatById = new Map(chatList.map(c => [c._id, c]));
    const out: QuickJumpRow[] = [];
    const seen = new Set<string>();

    const makeRow = (n: Node, visited: boolean): QuickJumpRow | null => {
      const c = chatById.get(n.chatId);
      if (!c) return null;          // orphan node — parent chat gone
      return { node: n, chat: c, visited, isRoot: c.rootNodeId === n._id };
    };

    for (const id of mru) {
      if (id === currentNodeId || seen.has(id)) continue;
      const n = nodeById.get(id);
      if (!n) continue;             // deleted node lingering in the MRU
      const row = makeRow(n, true);
      if (!row) continue;
      seen.add(id);
      out.push(row);
    }

    const rest = nodeList
      .filter(n => n._id !== currentNodeId && !seen.has(n._id))
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const n of rest) {
      const row = makeRow(n, false);
      if (row) out.push(row);
    }

    return out;
  }, [nodes, chats, mru, currentNodeId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ordered;
    return ordered.filter(r =>
      r.node.label.toLowerCase().includes(needle) ||
      r.chat.title.toLowerCase().includes(needle),
    );
  }, [ordered, q]);

  const jump = useCallback(async (row: QuickJumpRow) => {
    await db.chats.update(row.node.chatId, { currentNodeId: row.node._id });
    navigate(`/chat/${row.node.chatId}`);
    onClose();
  }, [navigate, onClose]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi(h => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi(h => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = filtered[hi];
      if (row) void jump(row);
    }
    // Escape is handled by useModalBehavior at the window level.
  };

  const noOtherNodes = ordered.length === 0;

  return (
    <div className="tw:fixed tw:inset-0 tw:bg-[color-mix(in_oklab,var(--ink)_30%,transparent)] tw:dark:bg-[var(--veil-black-60)] tw:backdrop-blur-[8px] tw:grid tw:[place-items:start_center] tw:pt-[14vh] tw:z-[200] tw:animate-[fadeIn_0.14s_ease-out]" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Quick jump" className="tw:w-[min(640px,92vw)] tw:bg-bg-3 tw:border tw:border-line tw:rounded-[16px] tw:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.4)] tw:overflow-hidden tw:animate-[popUp_0.18s_cubic-bezier(0.34,1.56,0.64,1)]" onClick={e => e.stopPropagation()}>
        <div className="tw:flex tw:items-center tw:gap-2.5 tw:py-3.5 tw:px-[18px] tw:border-b tw:border-line tw:[&_svg]:text-ink-3 tw:[&_svg]:flex-none">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            className="tw:flex-1 tw:border-none tw:bg-transparent tw:outline-none tw:text-[15px] tw:text-ink"
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to a branch…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="tw:font-mono tw:text-[10px] tw:bg-bg-2 tw:border tw:border-line tw:py-0.5 tw:px-[7px] tw:rounded-[4px] tw:text-ink-3">esc</span>
        </div>

        <div className="tw:max-h-[50vh] tw:overflow-y-auto tw:p-1.5">
          {noOtherNodes ? (
            <div className="tw:py-9 tw:px-[18px] tw:text-center tw:text-ink-3 tw:text-[13px]">No other branches — press ⌃N to start a chat.</div>
          ) : filtered.length === 0 ? (
            <div className="tw:py-9 tw:px-[18px] tw:text-center tw:text-ink-3 tw:text-[13px]">No branches match.</div>
          ) : (
            filtered.map((row, i) => {
              const title = row.chat.title || "Untitled chat";
              return (
                <div
                  key={row.node._id}
                  className={`tw:flex tw:items-center tw:gap-2.5 tw:py-2.5 tw:px-3.5 tw:rounded-[8px] tw:cursor-pointer tw:text-[14px] tw:text-ink tw:hover:bg-bg-2 ${i === hi ? "tw:bg-bg-2" : ""}`}
                  onClick={() => void jump(row)}
                  onMouseEnter={() => setHi(i)}
                >
                  <span className={`tw:w-[9px] tw:h-[9px] tw:rounded-[50%] tw:flex-none ${QJ_DOT[Math.min(3, row.node.depth)]}`} />
                  <span className="tw:flex-1">
                    {row.isRoot ? (
                      title
                    ) : (
                      <>
                        {title}
                        <span style={{ color: "var(--ink-3)", margin: "0 6px" }}>›</span>
                        {row.node.label || "branch"}
                      </>
                    )}
                  </span>
                  {row.isRoot && <span className="tw:text-[11px] tw:text-ink-3 tw:py-0.5 tw:px-[7px] tw:rounded-[999px] tw:bg-bg-2">root</span>}
                  {i === 0 && q.trim() === "" && (
                    <span className="tw:text-[11px] tw:text-ink-3 tw:py-0.5 tw:px-[7px] tw:rounded-[999px] tw:bg-bg-2">← back</span>
                  )}
                  <span className="tw:font-mono tw:text-[10px] tw:text-ink-3 tw:tracking-[0.02em]">
                    {row.visited ? relativeTime(row.node.createdAt) : "not visited"}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="tw:flex tw:items-center tw:gap-3.5 tw:py-2.5 tw:px-[18px] tw:border-t tw:border-line tw:font-mono tw:text-[10px] tw:text-ink-3 tw:tracking-[0.04em]">
          <span><span className="tw:font-mono tw:text-[10px] tw:bg-bg-2 tw:border tw:border-line tw:py-px tw:px-[5px] tw:rounded-[3px] tw:text-ink-2 tw:my-0 tw:mx-[3px]">↑</span><span className="tw:font-mono tw:text-[10px] tw:bg-bg-2 tw:border tw:border-line tw:py-px tw:px-[5px] tw:rounded-[3px] tw:text-ink-2 tw:my-0 tw:mx-[3px]">↓</span> navigate</span>
          <span><span className="tw:font-mono tw:text-[10px] tw:bg-bg-2 tw:border tw:border-line tw:py-px tw:px-[5px] tw:rounded-[3px] tw:text-ink-2 tw:my-0 tw:mx-[3px]">↵</span> jump</span>
          <span><span className="tw:font-mono tw:text-[10px] tw:bg-bg-2 tw:border tw:border-line tw:py-px tw:px-[5px] tw:rounded-[3px] tw:text-ink-2 tw:my-0 tw:mx-[3px]">esc</span> close</span>
          <span className="tw:ml-auto">
            {filtered.length} of {ordered.length}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── TreeMap ──────────────────────────────────────────────────────────────────

function TreeMap({
  chatId,
  currentNodeId,
  onClose,
}: {
  chatId:        string;
  currentNodeId: string;
  onClose:       () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useModalBehavior(true, onClose, rootRef);

  const chat  = useLiveQuery(() => db.chats.get(chatId), [chatId]);
  const nodes = useLiveQuery<Node[], Node[]>(
    () => db.nodes.where("chatId").equals(chatId).toArray(),
    [chatId],
    [],
  );

  const { points, edges, maxX, maxY } = useMemo(() => {
    const list = nodes ?? [];
    const roots = buildTree(list);
    const laid = layoutTree(roots);
    const pmap = new Map(laid.map(p => [p.nodeId, p]));
    const edgeList: Array<{ from: string; to: string }> = [];
    for (const n of list) {
      if (n.parentId && pmap.has(n.parentId)) {
        edgeList.push({ from: n.parentId, to: n._id });
      }
    }
    const mx = laid.reduce((m, p) => Math.max(m, p.x), 0);
    const my = laid.reduce((m, p) => Math.max(m, p.y), 0);
    return { points: laid, edges: edgeList, maxX: mx, maxY: my };
  }, [nodes]);

  const ancestors = useMemo(() => {
    const list = nodes ?? [];
    return new Set(findPath(list, currentNodeId));
  }, [nodes, currentNodeId]);

  // SVG canvas dimensions — generous so big trees scroll naturally.
  const W = Math.max(700, (maxX + 1) * 240);
  const H = Math.max(420, (maxY + 1) * 160);

  const xpx = useCallback((x: number) => {
    if (maxX === 0) return W / 2;
    return 130 + (x / maxX) * (W - 260);
  }, [maxX, W]);
  const ypx = useCallback((y: number) => {
    if (maxY === 0) return H / 2;
    return 80 + (y / maxY) * (H - 160);
  }, [maxY, H]);

  const pointById = useMemo(
    () => new Map(points.map(p => [p.nodeId, p])),
    [points],
  );
  const nodeById = useMemo(
    () => new Map((nodes ?? []).map(n => [n._id, n])),
    [nodes],
  );

  const pick = useCallback(async (nodeId: string) => {
    await db.chats.update(chatId, { currentNodeId: nodeId });
    onClose();
  }, [chatId, onClose]);

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label="Tree map" className="tw:fixed tw:inset-0 tw:bg-[color-mix(in_oklab,var(--bg)_96%,white)] tw:dark:bg-[color-mix(in_oklab,var(--bg)_88%,black)] tw:z-[150] tw:flex tw:flex-col tw:animate-[fadeIn_0.18s_ease-out]" onClick={onClose}>
      <div className="tw:flex tw:items-center tw:gap-4 tw:py-[18px] tw:px-7 tw:border-b tw:border-line tw:bg-bg-3" onClick={e => e.stopPropagation()}>
        <button className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink" onClick={onClose} title="Close (Esc)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <div className="tw:font-display tw:font-semibold tw:text-[22px] tw:tracking-[-0.02em] tw:flex-1">
          <em className="tw:font-serif tw:italic tw:text-coral tw:font-normal">{chat?.title ?? "Chat"}</em>
          <span style={{
            marginLeft: 10, fontFamily: "var(--mono)", fontSize: 11,
            color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            {points.length} node{points.length === 1 ? "" : "s"}
          </span>
        </div>
        <div style={{
          display: "flex", gap: 10, alignItems: "center",
          fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)",
        }}>
          <LegendDot color="var(--coral)"  label="root" />
          <LegendDot color="var(--teal)"   label="L1" />
          <LegendDot color="var(--lilac)"  label="L2" />
          <LegendDot color="var(--butter)" label="L3+" />
        </div>
      </div>

      <div className="tw:flex-1 tw:relative tw:overflow-hidden" onClick={e => e.stopPropagation()}>
        <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
          <div className="tw:relative" style={{ width: W, height: H, margin: "20px auto" }}>
            <svg className="tw:absolute tw:inset-0 tw:w-full tw:h-full" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
              {edges.map(({ from, to }) => {
                const a = pointById.get(from);
                const b = pointById.get(to);
                if (!a || !b) return null;
                const ax = xpx(a.x), ay = ypx(a.y);
                const bx = xpx(b.x), by = ypx(b.y);
                const my = (ay + by) / 2;
                const onPath = ancestors.has(from) && ancestors.has(to);
                return (
                  <path
                    key={`${from}-${to}`}
                    d={`M ${ax} ${ay} C ${ax} ${my}, ${bx} ${my}, ${bx} ${by}`}
                    stroke={onPath ? "var(--coral)" : "var(--line)"}
                    strokeWidth={onPath ? 2.5 : 2}
                    fill="none"
                  />
                );
              })}
            </svg>

            {points.map(p => {
              const n = nodeById.get(p.nodeId);
              if (!n) return null;
              const depth = Math.min(3, n.depth);
              const isCurrent  = n._id === currentNodeId;
              const isOnPath   = ancestors.has(n._id);
              const label      = n.label || (n.parentId === null ? "root" : `branch L${n.depth}`);
              const eyebrow    = n.parentId === null ? "root" : `branch L${n.depth}`;
              return (
                <div
                  key={n._id}
                  className={`tw:absolute tw:[transform:translate(-50%,-50%)] tw:w-[220px] tw:border-2 tw:rounded-[12px] tw:py-3 tw:px-3.5 tw:text-[13px] tw:cursor-pointer tw:transition-[transform,border-color,box-shadow] tw:duration-150 tw:ease-[ease] tw:z-[2] tw:hover:[transform:translate(-50%,-50%)_translateY(-2px)] tw:hover:shadow-2 ${TN_BORDER[depth]} ${isCurrent ? "tw:bg-ink tw:text-bg tw:shadow-[0_12px_28px_-8px_rgba(22,20,19,0.4)]" : "tw:bg-bg-3 tw:shadow-1"}`}
                  style={{
                    left:  xpx(p.x),
                    top:   ypx(p.y),
                    ...(isOnPath && !isCurrent
                      ? { borderColor: "var(--coral)", boxShadow: "0 8px 22px -8px rgba(0,0,0,0.28)" }
                      : {}),
                  }}
                  onClick={() => void pick(n._id)}
                >
                  <div className={`tw:font-mono tw:text-[9px] tw:tracking-[0.12em] tw:uppercase tw:mb-1 tw:flex tw:items-center tw:gap-[5px] ${isCurrent ? "tw:text-[color-mix(in_oklab,var(--bg)_70%,transparent)]" : "tw:text-ink-3"}`}>
                    <span className={`tw:w-[7px] tw:h-[7px] tw:rounded-[50%] ${TN_DOT[depth]}`} />
                    {eyebrow}
                  </div>
                  <div className="tw:font-display tw:font-semibold tw:text-[14px] tw:tracking-[-0.01em] tw:leading-[1.2] tw:text-balance">{truncate(label, 60)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// ── Shortcuts cheat sheet ────────────────────────────────────────────────────

interface ShortcutItem { keys: string[]; label: string }
interface ShortcutGroup { name: string; items: ShortcutItem[] }

function Shortcuts({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalBehavior(true, onClose, panelRef);

  const groups: ShortcutGroup[] = [
    {
      name: "Navigate",
      items: [
        { keys: ["⌘", "K"],        label: "Search everything (messages too)" },
        { keys: ["⌃", "Q"],        label: "Quick-jump to any node" },
        { keys: ["⌃", "T"],        label: "Open tree map" },
        { keys: ["⌃", "B"],        label: "Collapse / expand sidebar" },
        { keys: ["Esc"],           label: "Close overlay · cancel stream" },
      ],
    },
    {
      name: "Conversation",
      items: [
        { keys: ["⌃", "N"],        label: "New chat" },
        { keys: ["⌃", "R"],        label: "Toggle reflections mode" },
        { keys: ["⌃", ","],        label: "Open settings" },
      ],
    },
    {
      name: "Compose",
      items: [
        { keys: ["⌃", "↵"],        label: "Send message" },
        { keys: ["⇧", "↵"],        label: "New line" },
      ],
    },
    {
      name: "Help",
      items: [
        { keys: ["⌃", "/"],        label: "This cheat sheet" },
      ],
    },
  ];

  return (
    <div className="tw:fixed tw:inset-0 tw:bg-[color-mix(in_oklab,var(--ink)_30%,transparent)] tw:dark:bg-[var(--veil-black-60)] tw:backdrop-blur-[8px] tw:grid tw:[place-items:start_center] tw:pt-[14vh] tw:z-[200] tw:animate-[fadeIn_0.14s_ease-out]" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="tw:w-[min(640px,92vw)] tw:bg-bg-3 tw:border tw:border-line tw:rounded-[16px] tw:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.4)] tw:overflow-hidden tw:animate-[popUp_0.18s_cubic-bezier(0.34,1.56,0.64,1)]" style={{ width: "min(720px, 92vw)" }} onClick={e => e.stopPropagation()}>
        <div className="tw:flex tw:items-center tw:gap-2.5 tw:py-3.5 tw:px-[18px] tw:border-b tw:border-line tw:[&_svg]:text-ink-3 tw:[&_svg]:flex-none" style={{ padding: "16px 22px" }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: "var(--ink)" }}>
            <rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4 8 H6 M8 8 H10 M4 10 H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div style={{
            flex: 1, fontFamily: "var(--display)", fontWeight: 600,
            fontSize: 18, letterSpacing: "-0.015em",
          }}>
            Keyboard shortcuts
          </div>
          <button className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink" onClick={onClose} title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ padding: "16px 22px 22px", maxHeight: "60vh", overflowY: "auto" }}>
          {groups.map(g => (
            <div key={g.name} style={{ marginBottom: 20 }}>
              <div style={{
                fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.14em",
                textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8,
              }}>
                {g.name}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {g.items.map((it, i) => (
                  <div key={i} className="tw:flex tw:items-center tw:justify-between tw:py-[9px] tw:px-3 tw:rounded-[8px] tw:bg-bg tw:border tw:border-line tw:text-[13px]">
                    <span>{it.label}</span>
                    <span className="tw:flex tw:gap-1">
                      {it.keys.map((k, j) => <kbd key={j} className="tw:font-mono tw:text-[11px] tw:bg-bg-3 tw:border tw:border-line tw:shadow-[0_1px_0_var(--line)] tw:py-0.5 tw:px-1.5 tw:rounded-[5px] tw:text-ink">{k}</kbd>)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
