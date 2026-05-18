// src/components/chat/Overlays.tsx
// QuickJump (Ctrl+Q / Cmd+K), TreeMap (Ctrl+T), Shortcuts cheat sheet (Ctrl+/).
// Self-managed: installs a single global keydown listener and renders three modal
// overlays gated by local state. Consumer is ChatApp.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type Chat, type Node } from "../../lib/db";
import { buildTree, layoutTree, findPath } from "../../lib/path";

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
      {open === "quickjump" && <QuickJump onClose={close} />}
      {open === "treemap"   && <TreeMap chatId={chatId} currentNodeId={currentNodeId} onClose={close} />}
      {open === "shortcuts" && <Shortcuts onClose={close} />}
    </>
  );
}

export default Overlays;

// ── QuickJump ────────────────────────────────────────────────────────────────

interface QuickJumpResult {
  chatId:    string;
  chatTitle: string;
  nodeId:    string;
  label:     string;
  depth:     number;
  isRoot:    boolean;
}

function QuickJump({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const chats = useLiveQuery<Chat[], Chat[]>(() => db.chats.toArray(), [], []);
  const nodes = useLiveQuery<Node[], Node[]>(() => db.nodes.toArray(), [], []);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setHi(0); }, [q]);

  const items: QuickJumpResult[] = useMemo(() => {
    const chatList = chats ?? [];
    const nodeList = nodes ?? [];
    const chatById = new Map(chatList.map(c => [c._id, c]));
    const out: QuickJumpResult[] = [];
    for (const n of nodeList) {
      const c = chatById.get(n.chatId);
      if (!c) continue;
      out.push({
        chatId:    n.chatId,
        chatTitle: c.title,
        nodeId:    n._id,
        label:     n.label,
        depth:     n.depth,
        isRoot:    n._id === c.rootNodeId,
      });
    }
    // Sort: chat title asc, then depth asc
    out.sort((a, b) => {
      const t = a.chatTitle.localeCompare(b.chatTitle);
      if (t !== 0) return t;
      return a.depth - b.depth;
    });
    return out;
  }, [chats, nodes]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items.slice(0, 20);
    return items
      .filter(it => (it.label + " " + it.chatTitle).toLowerCase().includes(needle))
      .slice(0, 20);
  }, [items, q]);

  const jump = useCallback(async (it: QuickJumpResult) => {
    await db.chats.update(it.chatId, { currentNodeId: it.nodeId });
    navigate(`/chat/${it.chatId}`);
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
      const it = filtered[hi];
      if (it) void jump(it);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

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
            placeholder="Jump to any chat or node…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="qj-kbd">esc</span>
        </div>

        <div className="qj-list">
          {filtered.length === 0 ? (
            <div className="qj-empty">No matches</div>
          ) : (
            filtered.map((it, i) => (
              <div
                key={`${it.chatId}:${it.nodeId}`}
                className={`qj-item${i === hi ? " hi" : ""}`}
                data-depth={Math.min(3, it.depth)}
                onClick={() => void jump(it)}
                onMouseEnter={() => setHi(i)}
              >
                <span className="qj-dot" />
                <span className="qj-label">
                  {it.isRoot ? it.chatTitle : `${it.chatTitle} › ${it.label}`}
                </span>
                <span className="qj-chat">{it.isRoot ? "chat" : `L${it.depth}`}</span>
              </div>
            ))
          )}
        </div>

        <div className="qj-foot">
          <span><span className="qj-kbd">↑</span><span className="qj-kbd">↓</span> navigate</span>
          <span><span className="qj-kbd">↵</span> jump</span>
          <span><span className="qj-kbd">esc</span> close</span>
          <span style={{ marginLeft: "auto" }}>
            {filtered.length} of {items.length}
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
