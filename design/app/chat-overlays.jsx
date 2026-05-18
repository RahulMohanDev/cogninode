// chat-overlays.jsx — QuickJump (Ctrl+Q), TreeMap (full-screen tree), Shortcuts panel

const { pathToRoot, childrenOf } = window;

// ------------------------------------------------------------------
// Quick Jump (Ctrl+Q)
// Searchable list of all nodes across all chats. Enter = jump.
// ------------------------------------------------------------------
const QuickJump = ({ store, activeChatId, onClose, onJump }) => {
  const [q, setQ] = React.useState("");
  const [hi, setHi] = React.useState(0);
  const inputRef = React.useRef(null);

  // Flatten: current chat nodes first, then others
  const items = React.useMemo(() => {
    const out = [];
    const chatIds = [
      ...(activeChatId ? [activeChatId] : []),
      ...store.chatOrder.filter(id => id !== activeChatId),
    ];
    chatIds.forEach(cid => {
      const c = store.chats[cid];
      Object.values(c.nodes).forEach(n => {
        out.push({
          chatId: cid,
          chatTitle: c.title,
          nodeId: n.id,
          label: n.label,
          depth: n.depth,
        });
      });
    });
    return out;
  }, [store, activeChatId]);

  const filtered = React.useMemo(() => {
    if (!q.trim()) return items.slice(0, 40);
    const needle = q.toLowerCase();
    return items
      .filter(it => (it.label + " " + it.chatTitle).toLowerCase().includes(needle))
      .slice(0, 40);
  }, [items, q]);

  React.useEffect(() => { inputRef.current?.focus(); }, []);
  React.useEffect(() => { setHi(0); }, [q]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = filtered[hi]; if (it) onJump(it.chatId, it.nodeId); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="qj-overlay" onClick={onClose}>
      <div className="qj" onClick={(e) => e.stopPropagation()}>
        <div className="qj-input">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to any node…"
          />
          <span className="qj-kbd">esc</span>
        </div>
        <div className="qj-list">
          {filtered.length === 0 ? (
            <div className="qj-empty">No matches</div>
          ) : (
            filtered.map((it, i) => (
              <div
                key={it.chatId + ":" + it.nodeId}
                className={`qj-item ${i === hi ? "hi" : ""}`}
                data-depth={it.depth}
                onClick={() => onJump(it.chatId, it.nodeId)}
                onMouseEnter={() => setHi(i)}
              >
                <span className="qj-dot"></span>
                <span className="qj-label">{it.label}</span>
                <span className="qj-chat">{it.chatTitle}</span>
              </div>
            ))
          )}
        </div>
        <div className="qj-foot">
          <span><span className="qj-kbd">↑</span><span className="qj-kbd">↓</span> navigate</span>
          <span><span className="qj-kbd">↵</span> jump</span>
          <span><span className="qj-kbd">esc</span> close</span>
          <span style={{ marginLeft: "auto" }}>{filtered.length} of {items.length} nodes</span>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------
// Layout helpers for tree map
// ------------------------------------------------------------------
const layoutTree = (chat) => {
  const childrenMap = {};
  Object.values(chat.nodes).forEach(n => {
    if (n.parentId) (childrenMap[n.parentId] ||= []).push(n.id);
  });
  const positions = {};
  let leafX = 0;
  const compute = (id) => {
    const kids = childrenMap[id] || [];
    const depth = chat.nodes[id].depth;
    if (!kids.length) {
      positions[id] = { x: leafX++, y: depth };
      return positions[id].x;
    }
    const xs = kids.map(compute);
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    positions[id] = { x, y: depth };
    return x;
  };
  compute(chat.rootId);
  return { positions, maxX: Math.max(1, leafX - 1), maxY: Math.max(1, Math.max(...Object.values(positions).map(p => p.y))) };
};

// ------------------------------------------------------------------
// Tree map full-screen overlay
// ------------------------------------------------------------------
const TreeMap = ({ chat, currentNodeId, onClose, onPick }) => {
  const { positions, maxX, maxY } = React.useMemo(() => layoutTree(chat), [chat]);
  // Canvas dimensions
  const W = Math.max(700, (maxX + 1) * 260);
  const H = Math.max(420, (maxY + 1) * 180);
  const xpx = (id) => {
    if (maxX === 0) return W / 2;
    return 130 + (positions[id].x / maxX) * (W - 260);
  };
  const ypx = (id) => {
    if (maxY === 0) return H / 2;
    return 80 + (positions[id].y / maxY) * (H - 160);
  };

  return (
    <div className="tree-overlay">
      <div className="tree-overlay-head">
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="to-title">
          <em>{chat.title}</em>
          <span style={{ marginLeft: 10, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {Object.keys(chat.nodes).length} nodes
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--coral)" }}></span>root
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--teal)" }}></span>level 1
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--lilac)" }}></span>level 2
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--butter)" }}></span>level 3+
          </span>
        </div>
      </div>
      <div className="tree-overlay-body">
        <div className="tree-canvas" style={{ width: W, height: H, margin: "20px auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`}>
            {Object.values(chat.nodes).map(n => {
              if (!n.parentId) return null;
              const a = { x: xpx(n.parentId), y: ypx(n.parentId) };
              const b = { x: xpx(n.id), y: ypx(n.id) };
              const my = (a.y + b.y) / 2;
              const path = `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
              return <path key={n.id} d={path} stroke="var(--line)" strokeWidth="2" fill="none"/>;
            })}
          </svg>
          {Object.values(chat.nodes).map(n => {
            const depth = Math.min(3, n.depth);
            const msgCount = n.messages.length;
            const credits = n.messages.reduce((s, m) => s + (m.credits || 0), 0);
            return (
              <div
                key={n.id}
                className={`tree-node ${currentNodeId === n.id ? "current" : ""}`}
                data-depth={depth}
                style={{ left: xpx(n.id), top: ypx(n.id) }}
                onClick={() => onPick(n.id)}
              >
                <div className="tn-eyebrow">
                  <span className="tn-dot"></span>
                  {n.depth === 0 ? "root" : `branch L${n.depth}`}
                </div>
                <div className="tn-label">{n.label}</div>
                <div className="tn-meta">
                  {msgCount} {msgCount === 1 ? "message" : "messages"} · {credits} cr
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------
// Shortcuts panel
// ------------------------------------------------------------------
const ShortcutsPanel = ({ onClose }) => {
  const groups = [
    {
      name: "Navigate",
      items: [
        { keys: ["⌃", "Q"], label: "Quick-jump to any node" },
        { keys: ["⌃", "K"], label: "Search chats" },
        { keys: ["⌃", "↑/↓"], label: "Move up/down the tree" },
        { keys: ["Esc"], label: "Close overlay" },
      ],
    },
    {
      name: "Conversation",
      items: [
        { keys: ["⌃", "N"], label: "New chat" },
        { keys: ["⌃", "B"], label: "Branch from selection" },
        { keys: ["⌃", "R"], label: "Toggle reflections mode" },
        { keys: ["⌃", "T"], label: "Open tree map" },
      ],
    },
    {
      name: "Compose",
      items: [
        { keys: ["↵"], label: "Send message" },
        { keys: ["⇧", "↵"], label: "New line" },
        { keys: ["⌃", "/"], label: "Switch model" },
        { keys: ["⌃", "U"], label: "Attach file" },
      ],
    },
  ];
  return (
    <div className="qj-overlay" onClick={onClose}>
      <div className="qj" style={{ width: "min(720px, 92vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="qj-input" style={{ padding: "16px 22px" }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: "var(--ink)" }}>
            <rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M4 8 H6 M8 8 H10 M4 10 H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <div style={{ flex: 1, fontFamily: "var(--display)", fontWeight: 600, fontSize: 18, letterSpacing: "-0.015em" }}>
            Keyboard shortcuts
          </div>
          <button className="icon-btn" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div style={{ padding: "16px 22px 22px", maxHeight: "60vh", overflowY: "auto" }}>
          {groups.map(g => (
            <div key={g.name} style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>
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
};

Object.assign(window, { QuickJump, TreeMap, ShortcutsPanel, layoutTree });
