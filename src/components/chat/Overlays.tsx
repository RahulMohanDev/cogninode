// src/components/chat/Overlays.tsx
// QuickJump (Ctrl+Q / Cmd+K), TreeMap (Ctrl+T), Shortcuts cheat sheet (Ctrl+/).
// Self-managed: installs a single global keydown listener and renders three modal
// overlays gated by local state. Consumer is ChatApp.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type Chat, type Node } from "../../lib/db";
import { buildTree, layoutTree, findPath } from "../../lib/path";
import { getChatMRU } from "../../lib/chatHistory";

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
      if (inField && !ctrl && e.key !== "Escape") return;

      // Cmd+K or Ctrl+Q → QuickJump
      if (ctrl && (e.key === "q" || e.key === "Q" || e.key === "k" || e.key === "K")) {
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
      // Esc → close any open overlay (and stop propagation so it doesn't also cancel a stream)
      if (e.key === "Escape" && open !== null) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(null);
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open === "quickjump" && <QuickJump chatId={chatId} onClose={close} />}
      {open === "treemap"   && <TreeMap chatId={chatId} currentNodeId={currentNodeId} onClose={close} />}
      {open === "shortcuts" && <Shortcuts onClose={close} />}
    </>
  );
}

export default Overlays;

// ── QuickJump ────────────────────────────────────────────────────────────────
// An MRU ("Alt+Tab") chat switcher. With an empty search box the chat the
// user just switched FROM is at index 0 and pre-selected, so Ctrl+Q then
// Enter toggles back to it. Below it: every other visited chat in
// most-recently-visited order, then never-visited chats by updatedAt.

interface QuickJumpRow {
  chat:    Chat;
  visited: boolean;
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

function QuickJump({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const chats = useLiveQuery<Chat[], Chat[]>(() => db.chats.toArray(), [], []);

  // Snapshot the MRU once when the overlay mounts — it must not reorder
  // mid-session as Chat.tsx records the very chat we may jump to.
  const mru = useMemo(() => getChatMRU(), []);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setHi(0); }, [q]);

  // The ordered switcher list (current chat excluded):
  //   1. MRU chats in most-recently-visited order — index 0 is the
  //      just-switched-from chat, which we pre-select.
  //   2. Never-visited chats by updatedAt descending.
  const ordered: QuickJumpRow[] = useMemo(() => {
    const chatList = chats ?? [];
    const byId = new Map(chatList.map(c => [c._id, c]));
    const out: QuickJumpRow[] = [];
    const seen = new Set<string>();

    for (const id of mru) {
      if (id === chatId || seen.has(id)) continue;
      const c = byId.get(id);
      if (!c) continue;            // deleted chat lingering in the MRU
      seen.add(id);
      out.push({ chat: c, visited: true });
    }

    const rest = chatList
      .filter(c => c._id !== chatId && !seen.has(c._id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const c of rest) out.push({ chat: c, visited: false });

    return out;
  }, [chats, mru, chatId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ordered;
    return ordered.filter(r => r.chat.title.toLowerCase().includes(needle));
  }, [ordered, q]);

  const jump = useCallback((id: string) => {
    navigate(`/chat/${id}`);
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
      if (row) jump(row.chat._id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const noOtherChats = ordered.length === 0;

  return (
    <div className="qj-overlay" onClick={onClose}>
      <div className="qj" onClick={e => e.stopPropagation()}>
        <div className="qj-input">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Switch to a chat…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="qj-kbd">esc</span>
        </div>

        <div className="qj-list">
          {noOtherChats ? (
            <div className="qj-empty">No other chats — press ⌃N to start one.</div>
          ) : filtered.length === 0 ? (
            <div className="qj-empty">No chats match.</div>
          ) : (
            filtered.map((row, i) => (
              <div
                key={row.chat._id}
                className={`qj-item${i === hi ? " hi" : ""}`}
                onClick={() => jump(row.chat._id)}
                onMouseEnter={() => setHi(i)}
              >
                <span className="qj-dot" />
                <span className="qj-label">{row.chat.title || "Untitled chat"}</span>
                {i === 0 && q.trim() === "" && (
                  <span className="qj-chat">← back</span>
                )}
                <span className="qj-path">
                  {row.visited ? relativeTime(row.chat.updatedAt) : "not visited"}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="qj-foot">
          <span><span className="qj-kbd">↑</span><span className="qj-kbd">↓</span> navigate</span>
          <span><span className="qj-kbd">↵</span> switch</span>
          <span><span className="qj-kbd">esc</span> close</span>
          <span style={{ marginLeft: "auto" }}>
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
    <div className="tree-overlay" onClick={onClose}>
      <div className="tree-overlay-head" onClick={e => e.stopPropagation()}>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <div className="to-title">
          <em>{chat?.title ?? "Chat"}</em>
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

      <div className="tree-overlay-body" onClick={e => e.stopPropagation()}>
        <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
          <div className="tree-canvas" style={{ width: W, height: H, margin: "20px auto", position: "relative" }}>
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
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
                  className={`tree-node${isCurrent ? " current" : ""}`}
                  data-depth={depth}
                  style={{
                    left:  xpx(p.x),
                    top:   ypx(p.y),
                    ...(isOnPath && !isCurrent
                      ? { borderColor: "var(--coral)", boxShadow: "0 8px 22px -8px rgba(0,0,0,0.28)" }
                      : {}),
                  }}
                  onClick={() => void pick(n._id)}
                >
                  <div className="tn-eyebrow">
                    <span className="tn-dot" />
                    {eyebrow}
                  </div>
                  <div className="tn-label">{truncate(label, 60)}</div>
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
  const groups: ShortcutGroup[] = [
    {
      name: "Navigate",
      items: [
        { keys: ["⌃", "Q"],        label: "Quick-jump to any node" },
        { keys: ["⌘", "K"],        label: "Quick-jump (alt)" },
        { keys: ["⌃", "T"],        label: "Open tree map" },
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
    <div className="qj-overlay" onClick={onClose}>
      <div className="qj" style={{ width: "min(720px, 92vw)" }} onClick={e => e.stopPropagation()}>
        <div className="qj-input" style={{ padding: "16px 22px" }}>
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
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
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
                  <div key={i} className="shortcut-card">
                    <span>{it.label}</span>
                    <span className="keys">
                      {it.keys.map((k, j) => <kbd key={j}>{k}</kbd>)}
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
