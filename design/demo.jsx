// Live interactive cogninode demo.
// Multi-tree (each "conversation" is its own tree), Ctrl+Q opens a quick list,
// "View tree" toggle zooms out to a visual map, click any node to fly in,
// and a "+" creates a new tree.

const CANNED = {
  "weight training": "Weight training builds strength by progressively loading your muscles. Splits like push/pull/legs work well. 8–12 reps for hypertrophy, 3–6 for pure strength.",
  "yoga": "Yoga blends posture, breath, and mindfulness. Vinyasa flows are dynamic, Yin emphasizes long holds. A 20-minute morning flow can transform mobility over weeks.",
  "hiit": "HIIT alternates short bursts of near-max effort with brief recoveries. Classic protocol: 30s on / 30s off for 8 rounds. Time-efficient and great for cardio fitness.",
  "swimming": "Swimming is low-impact and full-body. The four strokes — freestyle, backstroke, breaststroke, butterfly — each emphasize different muscles. 20 laps three times a week makes a real difference.",
  "progressive overload": "Progressive overload means gradually increasing the demand on your muscles. The three levers are load (weight), volume (reps × sets), and frequency. Change one at a time.",
  "vinyasa": "Vinyasa links breath to movement in a continuous flow. A sun salutation is the simplest example. Great for building heat and rhythm.",
  "freestyle": "Freestyle (front crawl) is the fastest stroke. Focus on a long body position, high elbow catch, and bilateral breathing every 3 strokes for symmetry.",
};
const cannedFor = (label) => {
  const k = label.toLowerCase();
  for (const key of Object.keys(CANNED)) if (k.includes(key)) return CANNED[key];
  return `Let's go deeper into "${label}". This is a focused branch — only the parent path is in context, so I can give you a tighter answer.`;
};
const callAI = async (label, parentSummary) => {
  const prompt = `Continue a "branch" of a tree-shaped AI chat. The user is drilling into a specific idea from a longer reply.

Path so far: ${parentSummary}
The user wants to know more about: "${label}"

Respond in 2-3 short concrete sentences. No filler like "great question" or "let me know if you need more". Just substance.`;
  try {
    if (window.claude && window.claude.complete) {
      const text = await window.claude.complete(prompt);
      if (text && text.trim()) return text.trim();
    }
  } catch (e) { /* fall through */ }
  return cannedFor(label);
};

const splitSentences = (text) => {
  const out = [];
  text.split("\n").forEach((line) => {
    if (!line.trim()) { out.push({ type: "br" }); return; }
    if (/^[•\-\*]\s/.test(line)) {
      const body = line.replace(/^[•\-\*]\s/, "");
      const parts = body.split(/ — | - /);
      out.push({
        type: "bullet",
        leadLabel: parts[0],
        leadTail: parts.length > 1 ? " — " + parts.slice(1).join(" — ") : "",
      });
    } else {
      const sents = line.match(/[^.!?]+[.!?]?/g) || [line];
      sents.forEach((s) => { if (s.trim()) out.push({ type: "sentence", text: s }); });
    }
  });
  return out;
};
const tokenCountOf = (s) => Math.max(1, Math.round(s.length / 3.6));

// Tree starter templates for the "+ new conversation" button
const STARTERS = [
  {
    name: "Workouts overview",
    root: {
      label: "Forms of workouts",
      messages: [
        { role: "user", content: "What are the different forms of workouts?" },
        { role: "assistant", content:
          "There are four common forms.\n• Weight training — resistance work that builds strength.\n• Yoga — flexibility, breath, balance.\n• HIIT — short bursts of high intensity.\n• Swimming — full-body, low-impact endurance." },
      ],
    },
  },
  {
    name: "Trip to Japan",
    root: {
      label: "Plan a trip to Japan",
      messages: [
        { role: "user", content: "Help me plan a 10-day trip to Japan." },
        { role: "assistant", content:
          "A balanced 10-day route covers three regions.\n• Tokyo — modern megalopolis, day trips to Nikko and Hakone.\n• Kyoto — temples, gardens, and a Nara side trip for the deer.\n• Osaka — food capital, gateway to Hiroshima and Miyajima." },
      ],
    },
  },
  {
    name: "useState explained",
    root: {
      label: "React useState",
      messages: [
        { role: "user", content: "Explain useState in React." },
        { role: "assistant", content:
          "useState is a hook for local component state.\n• Signature — const [value, setValue] = useState(initial)\n• Updates — calling setValue re-renders the component\n• Closure pitfall — stale values in event handlers if you don't read fresh state" },
      ],
    },
  },
];

// Helper: layout a tree of nodes for the zoom-out visualization
const layoutTree = (nodes, rootId) => {
  // Group children
  const childrenOf = {};
  Object.values(nodes).forEach(n => {
    if (n.parentId) (childrenOf[n.parentId] ||= []).push(n.id);
  });
  // Assign x by DFS, y by depth
  const positions = {};
  let leafX = 0;
  const computeX = (id) => {
    const kids = childrenOf[id] || [];
    if (kids.length === 0) {
      positions[id] = { x: leafX++, depth: nodes[id].depth };
      return positions[id].x;
    }
    const xs = kids.map(computeX);
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    positions[id] = { x, depth: nodes[id].depth };
    return x;
  };
  computeX(rootId);
  const maxX = Math.max(1, leafX - 1);
  const maxDepth = Math.max(...Object.values(positions).map(p => p.depth), 1);
  // Normalize to 10-90% horizontal, 15-85% vertical
  Object.keys(positions).forEach(id => {
    const px = maxX === 0 ? 0.5 : positions[id].x / maxX;
    const py = positions[id].depth / maxDepth;
    positions[id] = { x: 10 + px * 80, y: 15 + py * 70 };
  });
  return { positions, childrenOf };
};

const newId = () => "n" + Math.random().toString(36).slice(2, 8);
const newTreeId = () => "t" + Math.random().toString(36).slice(2, 8);

const buildTreeFromStarter = (starter) => {
  const tid = newTreeId();
  const rid = "root";
  return {
    id: tid,
    name: starter.name,
    rootId: rid,
    nodes: {
      [rid]: {
        id: rid,
        parentId: null,
        depth: 0,
        label: starter.root.label,
        messages: starter.root.messages,
      },
    },
  };
};

const LiveDemo = () => {
  const [trees, setTrees] = React.useState(() => {
    const t = buildTreeFromStarter(STARTERS[0]);
    return { [t.id]: t };
  });
  const [activeTreeId, setActiveTreeId] = React.useState(() => Object.keys(trees)[0]);
  const [activeNodeId, setActiveNodeId] = React.useState("root");
  const [loadingNodeId, setLoadingNodeId] = React.useState(null);
  const [reflected, setReflected] = React.useState({}); // {treeId:nodeId:msgIdx:sentIdx -> true}
  const [view, setView] = React.useState("chat"); // 'chat' | 'list' | 'tree'
  const [picker, setPicker] = React.useState(false); // overlay open
  const [showHint, setShowHint] = React.useState(true);
  const [pickerTab, setPickerTab] = React.useState("list"); // 'list' | 'tree'
  const [creatingNew, setCreatingNew] = React.useState(false);
  // drafts[`${treeId}:${nodeId}`] = { quote?: string, text: string }
  const [drafts, setDrafts] = React.useState({});
  const [currentModel, setCurrentModel] = React.useState("claude");
  const [modelOpen, setModelOpen] = React.useState(false);
  const streamRef = React.useRef(null);

  const MODELS_LIST = window.MODELS || [];
  const activeModelMeta = MODELS_LIST.find(m => m.id === currentModel) || MODELS_LIST[0];

  const activeTree = trees[activeTreeId];
  const activeNode = activeTree?.nodes[activeNodeId];

  // Token math
  const tokensInPath = React.useMemo(() => {
    if (!activeTree || !activeNode) return 0;
    let id = activeNodeId, sum = 0;
    while (id) {
      const n = activeTree.nodes[id];
      if (!n) break;
      n.messages.forEach(m => sum += tokenCountOf(m.content));
      id = n.parentId;
    }
    return sum;
  }, [activeTree, activeNodeId, activeNode]);

  const tokensTotalAllTrees = React.useMemo(() => {
    let sum = 0;
    Object.values(trees).forEach(t =>
      Object.values(t.nodes).forEach(n =>
        n.messages.forEach(m => sum += tokenCountOf(m.content))
      )
    );
    return sum;
  }, [trees]);
  const saved = Math.max(0, tokensTotalAllTrees - tokensInPath);

  // Scroll chat down on new content
  React.useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [activeNodeId, activeTreeId, loadingNodeId, trees]);

  // Keyboard: Ctrl+Q toggles picker, Esc closes
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "q") {
        e.preventDefault();
        setPicker(p => !p);
      } else if (e.key === "Escape") {
        setPicker(false);
        if (view === "tree") setView("chat");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const branchFrom = (label, parentNode) => {
    if (!activeTree) return;
    setShowHint(false);
    const id = newId();
    setTrees(prev => ({
      ...prev,
      [activeTreeId]: {
        ...prev[activeTreeId],
        nodes: {
          ...prev[activeTreeId].nodes,
          [id]: {
            id, parentId: parentNode.id,
            depth: parentNode.depth + 1,
            label,
            messages: [],
          },
        },
      },
    }));
    setActiveNodeId(id);
    // Pre-fill the draft with the quote + a useful starter text
    setDrafts(d => ({
      ...d,
      [`${activeTreeId}:${id}`]: {
        quote: label,
        text: "what's the best way to start?",
      },
    }));
  };

  const sendDraft = async () => {
    const key = `${activeTreeId}:${activeNodeId}`;
    const draft = drafts[key];
    if (!draft || !draft.text.trim()) return;
    const text = draft.text.trim();
    const quote = draft.quote;

    // Append user message
    setTrees(prev => ({
      ...prev,
      [activeTreeId]: {
        ...prev[activeTreeId],
        nodes: {
          ...prev[activeTreeId].nodes,
          [activeNodeId]: {
            ...prev[activeTreeId].nodes[activeNodeId],
            messages: [
              ...prev[activeTreeId].nodes[activeNodeId].messages,
              { role: "user", quote: quote || null, content: text },
            ],
          },
        },
      },
    }));
    // Clear draft (keep no quote going forward in this thread)
    setDrafts(d => ({ ...d, [key]: { text: "" } }));
    setLoadingNodeId(activeNodeId);
    const askLabel = quote || text;
    const response = await callAI(askLabel, `(${activeNode.label})`);
    setTrees(prev => ({
      ...prev,
      [activeTreeId]: {
        ...prev[activeTreeId],
        nodes: {
          ...prev[activeTreeId].nodes,
          [activeNodeId]: {
            ...prev[activeTreeId].nodes[activeNodeId],
            messages: [
              ...prev[activeTreeId].nodes[activeNodeId].messages,
              { role: "assistant", content: response },
            ],
          },
        },
      },
    }));
    setLoadingNodeId(null);
  };

  const updateDraft = (patch) => {
    const key = `${activeTreeId}:${activeNodeId}`;
    setDrafts(d => ({ ...d, [key]: { ...(d[key] || {}), ...patch } }));
  };
  const removeDraftQuote = () => updateDraft({ quote: undefined });

  const reflectKey = (msgIdx, sentIdx) => `${activeTreeId}:${activeNodeId}:${msgIdx}:${sentIdx}`;
  const toggleReflect = (msgIdx, sentIdx) =>
    setReflected(r => ({ ...r, [reflectKey(msgIdx, sentIdx)]: !r[reflectKey(msgIdx, sentIdx)] }));

  // Flatten sidebar nodes for active tree
  const sidebarNodes = React.useMemo(() => {
    if (!activeTree) return [];
    const out = [];
    const walk = (id) => {
      const n = activeTree.nodes[id]; if (!n) return;
      out.push(n);
      Object.values(activeTree.nodes).filter(c => c.parentId === id).forEach(c => walk(c.id));
    };
    walk(activeTree.rootId);
    return out;
  }, [activeTree]);

  // Build breadcrumb path
  const breadcrumb = React.useMemo(() => {
    if (!activeTree || !activeNode) return [];
    const path = [];
    let id = activeNodeId;
    while (id) {
      const n = activeTree.nodes[id]; if (!n) break;
      path.unshift(n);
      id = n.parentId;
    }
    return path;
  }, [activeTree, activeNode, activeNodeId]);

  // Layout for tree view
  const treeLayout = React.useMemo(() => {
    if (!activeTree) return { positions: {}, childrenOf: {} };
    return layoutTree(activeTree.nodes, activeTree.rootId);
  }, [activeTree]);

  const createNewTree = (starter) => {
    const t = buildTreeFromStarter(starter);
    setTrees(prev => ({ ...prev, [t.id]: t }));
    setActiveTreeId(t.id);
    setActiveNodeId("root");
    setCreatingNew(false);
    setPicker(false);
    setView("chat");
  };

  const jumpTo = (treeId, nodeId) => {
    setActiveTreeId(treeId);
    setActiveNodeId(nodeId);
    setPicker(false);
    setView("chat");
  };

  if (!activeTree || !activeNode) return null;

  return (
    <div className="demo-app">
      {/* Sidebar */}
      <aside className="demo-sidebar">
        {/* Tree switcher */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, padding: "0 4px" }}>
          <h4 style={{ margin: 0 }}>Conversations</h4>
          <button
            onClick={() => setCreatingNew(true)}
            title="New conversation"
            style={{
              background: "var(--ink)", color: "var(--bg)",
              border: "none", borderRadius: 6,
              width: 22, height: 22, display: "grid", placeItems: "center",
              cursor: "pointer", padding: 0,
            }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <path d="M8 3 V13 M3 8 H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 }}>
          {Object.values(trees).map(t => (
            <div key={t.id}
              onClick={() => { setActiveTreeId(t.id); setActiveNodeId(t.rootId); setView("chat"); }}
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                fontSize: 12,
                cursor: "pointer",
                background: t.id === activeTreeId ? "color-mix(in oklab, var(--coral-soft) 35%, transparent)" : "transparent",
                color: t.id === activeTreeId ? "var(--ink)" : "var(--ink-2)",
                fontWeight: t.id === activeTreeId ? 500 : 400,
                display: "flex", alignItems: "center", gap: 8,
                border: t.id === activeTreeId ? "1px solid var(--coral)" : "1px solid transparent",
              }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.id === activeTreeId ? "var(--coral)" : "var(--ink-3)" }}></span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--ink-3)" }}>
                {Object.keys(t.nodes).length}
              </span>
            </div>
          ))}
        </div>

        <h4>Nodes in this tree</h4>
        {sidebarNodes.map(n => {
          const myTokens = n.messages.reduce((s, m) => s + tokenCountOf(m.content), 0);
          return (
            <div key={n.id}
              className={`tree-node ${n.id === activeNodeId ? "active" : ""}`}
              data-depth={Math.min(n.depth, 2)}
              onClick={() => { setActiveNodeId(n.id); setView("chat"); }}
              title={n.label}>
              <span className="bullet"></span>
              <span className="label">{n.label}</span>
              <span className="tokens">{myTokens}t</span>
            </div>
          );
        })}

        <div style={{ marginTop: 18, padding: "10px 8px", borderTop: "1px solid var(--line)" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 4 }}>Saved this session</div>
          <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 600, color: "var(--teal)" }}>−{saved} tokens</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>vs. one flat conversation</div>
        </div>
      </aside>

      {/* Main area */}
      <main className="demo-main">
        <div className="demo-toolbar">
          <div className="breadcrumb">
            <span style={{ color: "var(--ink-3)", marginRight: 8, textTransform: "none", letterSpacing: 0 }}>{activeTree.name}</span>
            <i className="sep">/</i>
            {breadcrumb.map((n, i) => (
              <React.Fragment key={n.id}>
                {i > 0 && <i className="sep">/</i>}
                <b>{n.label.length > 26 ? n.label.slice(0, 24) + "…" : n.label}</b>
              </React.Fragment>
            ))}
          </div>
          {/* Model picker */}
          {activeModelMeta && (
            <div style={{ position: "relative" }}>
              <span className="model-badge" onClick={() => setModelOpen(v => !v)}>
                <span className="model-dot" style={{
                  width: 14, height: 14, background: activeModelMeta.color, fontSize: 8,
                }}>{activeModelMeta.glyph}</span>
                {activeModelMeta.name}
                <svg className="caret" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6 L8 10 L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </span>
              {modelOpen && (
                <div className="model-dropdown" style={{ top: "calc(100% + 6px)", right: 0 }}>
                  {MODELS_LIST.map(m => (
                    <div key={m.id}
                      className={`model-row ${m.id === currentModel ? "active" : ""}`}
                      onClick={() => { setCurrentModel(m.id); setModelOpen(false); }}>
                      <span className="model-dot" style={{ width: 22, height: 22, background: m.color, fontSize: 10 }}>{m.glyph}</span>
                      <div className="model-meta">
                        <span className="model-name">{m.name}</span>
                        <span className="model-tagline">{m.tagline}</span>
                      </div>
                      <svg className="check" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8 L7 12 L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  ))}
                  <div className="model-row connect" onClick={() => setModelOpen(false)}>
                    <span className="model-dot">+</span>
                    <div className="model-meta">
                      <span className="model-name">Connect API key…</span>
                      <span className="model-tagline">openai · anthropic · openrouter</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <span className="badge">depth {activeNode.depth}</span>
          <span className="badge" onClick={() => setView(view === "tree" ? "chat" : "tree")} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="3" r="1.6" fill="currentColor"/><circle cx="3" cy="13" r="1.6" fill="currentColor"/><circle cx="13" cy="13" r="1.6" fill="currentColor"/>
              <path d="M8 4.5 L3 11.5 M8 4.5 L13 11.5" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            {view === "tree" ? "Chat" : "Tree"}
          </span>
          <span className="badge" onClick={() => setPicker(true)} style={{ cursor: "pointer" }}>
            <span className="kbd" style={{ minWidth: 0, padding: "1px 5px", boxShadow: "none", fontSize: 10 }}>Ctrl</span>
            <span className="kbd" style={{ minWidth: 0, padding: "1px 5px", boxShadow: "none", fontSize: 10, marginLeft: 4 }}>Q</span>
          </span>
        </div>

        {/* The big stage — either chat or zoom-out tree view */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {/* CHAT VIEW */}
          <div style={{
            position: "absolute", inset: 0,
            opacity: view === "chat" ? 1 : 0,
            transform: `scale(${view === "chat" ? 1 : 0.5})`,
            transformOrigin: "center center",
            transition: "opacity 0.5s, transform 0.6s cubic-bezier(0.65,0,0.35,1)",
            pointerEvents: view === "chat" ? "auto" : "none",
            display: "flex", flexDirection: "column",
          }}>
            <div className="token-pill" style={{ position: "absolute" }}>
              <span className="pulse"></span>
              {tokensInPath}t in context
            </div>

            <div className="demo-stream" ref={streamRef}>
              {activeNode.messages.map((m, i) => {
                if (m.role === "user") {
                  if (m.quote) {
                    return (
                      <div key={i} className="bubble user with-quote">
                        <div className="quote-block">
                          <span className="quote-from">
                            <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                              <path d="M4 7 V11 H7 L5 14 M10 7 V11 H13 L11 14" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                            </svg>
                            Branched from parent
                          </span>
                          <span className="quote-text">{m.quote}</span>
                        </div>
                        <div>{m.content}</div>
                      </div>
                    );
                  }
                  return <div key={i} className="bubble user">{m.content}</div>;
                }
                const parts = splitSentences(m.content);
                let sentIdx = 0;
                return (
                  <div key={i} className="bubble assistant" style={{ maxWidth: "92%" }}>
                    <div className="meta">{tokenCountOf(m.content)} tokens · click any line to branch</div>
                    {parts.map((p, pi) => {
                      if (p.type === "br") return <div key={pi} style={{ height: 4 }}></div>;
                      if (p.type === "bullet") {
                        const myIdx = sentIdx++;
                        const isReflected = reflected[reflectKey(i, myIdx)];
                        return (
                          <div key={pi} style={{
                            display: "flex", gap: 6, lineHeight: 1.55,
                            opacity: isReflected ? 0.3 : 1,
                            textDecoration: isReflected ? "line-through" : "none",
                          }}>
                            <span style={{ color: "var(--coral)", fontWeight: 700 }}>•</span>
                            <span>
                              <span
                                className="selectable"
                                onClick={() => !isReflected && branchFrom(p.leadLabel, activeNode)}
                                style={{
                                  cursor: isReflected ? "default" : "pointer",
                                  padding: "0 3px", borderRadius: 4,
                                  background: "var(--coral-soft)", color: "var(--ink)",
                                  fontWeight: 500,
                                }}>
                                {p.leadLabel}
                              </span>
                              {p.leadTail}
                              <button
                                title="Reflect this line out"
                                onClick={(e) => { e.stopPropagation(); toggleReflect(i, myIdx); }}
                                style={{
                                  marginLeft: 6, border: "none", background: "transparent",
                                  color: "var(--lilac)", fontSize: 11, cursor: "pointer", padding: 0,
                                  opacity: 0.5,
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                                onMouseLeave={(e) => e.currentTarget.style.opacity = 0.5}>
                                ✕
                              </button>
                            </span>
                          </div>
                        );
                      }
                      const myIdx = sentIdx++;
                      const isReflected = reflected[reflectKey(i, myIdx)];
                      return (
                        <span key={pi}
                          className="selectable"
                          onClick={() => !isReflected && branchFrom(p.text.trim().replace(/[.!?]$/, ""), activeNode)}
                          style={{
                            cursor: isReflected ? "default" : "pointer",
                            opacity: isReflected ? 0.3 : 1,
                            textDecoration: isReflected ? "line-through" : "none",
                            padding: "0 2px", borderRadius: 3,
                          }}
                          onMouseEnter={(e) => { if (!isReflected) e.currentTarget.style.background = "var(--coral-soft)"; }}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                          {p.text}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
              {loadingNodeId === activeNodeId && (
                <div className="bubble assistant" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className="loader-dot"></span>
                  <span className="loader-dot" style={{ animationDelay: "0.15s" }}></span>
                  <span className="loader-dot" style={{ animationDelay: "0.3s" }}></span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ink-3)" }}>thinking with only this branch's context…</span>
                </div>
              )}

              {showHint && activeNodeId === activeTree.rootId && (
                <div style={{
                  alignSelf: "center", fontFamily: "var(--mono)", fontSize: 11,
                  color: "var(--coral)",
                  background: "color-mix(in oklab, var(--coral-soft) 50%, transparent)",
                  padding: "8px 14px", borderRadius: 999,
                  border: "1px dashed var(--coral)",
                  marginTop: 8, letterSpacing: "0.04em",
                }}>
                  ↑ click any highlighted phrase to branch · ✕ to reflect · Ctrl+Q to jump
                </div>
              )}
            </div>

            <form className="demo-input" onSubmit={(e) => { e.preventDefault(); sendDraft(); }}>
              {(() => {
                const draft = drafts[`${activeTreeId}:${activeNodeId}`] || {};
                return (
                  <>
                    {draft.quote && (
                      <div style={{ padding: "2px 4px" }}>
                        <span className="quote-chip">
                          <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                            <path d="M4 7 V11 H7 L5 14 M10 7 V11 H13 L11 14" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                          </svg>
                          <span className="quote-chip-text">{draft.quote}</span>
                          <button type="button" className="quote-chip-x" onClick={removeDraftQuote} tabIndex={-1}>
                            <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
                          </button>
                        </span>
                      </div>
                    )}
                    <div className="input-row">
                      <input
                        value={draft.text || ""}
                        onChange={(e) => updateDraft({ text: e.target.value })}
                        placeholder={draft.quote ? "Add more context…" : "Ask anything in this branch…"}
                        autoFocus={!!draft.quote}
                      />
                      <button type="submit" disabled={!(draft.text || "").trim()}>
                        Send
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M3 8 H13 M9 4 L13 8 L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </>
                );
              })()}
            </form>
          </div>

          {/* TREE VIEW (zoomed out) */}
          <div style={{
            position: "absolute", inset: 0,
            opacity: view === "tree" ? 1 : 0,
            transform: `scale(${view === "tree" ? 1 : 1.6})`,
            transformOrigin: "center center",
            transition: "opacity 0.5s, transform 0.6s cubic-bezier(0.65,0,0.35,1)",
            pointerEvents: view === "tree" ? "auto" : "none",
            background: "color-mix(in oklab, var(--bg-2) 50%, var(--bg-3))",
          }}>
            <div style={{
              position: "absolute", top: 16, left: 18,
              fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)",
              letterSpacing: "0.12em", textTransform: "uppercase",
            }}>
              Tree map · click any node to fly in
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
              {Object.values(activeTree.nodes).map(n => {
                if (!n.parentId) return null;
                const a = treeLayout.positions[n.parentId];
                const b = treeLayout.positions[n.id];
                if (!a || !b) return null;
                const cy = (a.y + b.y) / 2;
                const d = `M ${a.x} ${a.y} C ${a.x} ${cy}, ${b.x} ${cy}, ${b.x} ${b.y}`;
                return <path key={n.id} d={d} fill="none" stroke="var(--ink)" strokeOpacity="0.18" strokeWidth="1" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>;
              })}
            </svg>
            {Object.values(activeTree.nodes).map(n => {
              const pos = treeLayout.positions[n.id]; if (!pos) return null;
              const isCurrent = n.id === activeNodeId;
              const color = n.depth === 0 ? "var(--ink)" : n.depth === 1 ? "var(--coral)" : "var(--lilac)";
              return (
                <div key={n.id}
                  onClick={() => { setActiveNodeId(n.id); setView("chat"); }}
                  style={{
                    position: "absolute",
                    left: `${pos.x}%`, top: `${pos.y}%`,
                    transform: "translate(-50%, -50%)",
                    cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    zIndex: 2,
                  }}>
                  <span style={{
                    width: isCurrent ? 26 : 16, height: isCurrent ? 26 : 16,
                    borderRadius: "50%", background: color,
                    border: `${isCurrent ? 4 : 3}px solid var(--bg-3)`,
                    boxShadow: isCurrent
                      ? `0 0 0 5px color-mix(in oklab, ${color} 22%, transparent), 0 4px 14px -4px color-mix(in oklab, ${color} 60%, transparent)`
                      : `0 1px 3px rgba(22,20,19,0.12), 0 0 0 1px color-mix(in oklab, ${color} 18%, transparent)`,
                    transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}></span>
                  <span style={{
                    fontSize: 11, fontWeight: isCurrent ? 600 : 500,
                    color: isCurrent ? "white" : "var(--ink)",
                    background: isCurrent ? color : "color-mix(in oklab, var(--bg-3) 80%, transparent)",
                    padding: isCurrent ? "2px 10px" : "1px 6px",
                    borderRadius: 6,
                    whiteSpace: "nowrap", letterSpacing: "-0.005em",
                    maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis",
                  }}>{n.label}</span>
                  {isCurrent && (
                    <span style={{
                      fontFamily: "var(--mono)", fontSize: 9, color: color,
                      letterSpacing: "0.1em", textTransform: "uppercase", marginTop: -2,
                    }}>here</span>
                  )}
                </div>
              );
            })}
            <div style={{
              position: "absolute", bottom: 16, right: 16,
              fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)",
              letterSpacing: "0.06em",
            }}>
              Esc to close · Ctrl+Q for list
            </div>
          </div>
        </div>

        {/* Ctrl+Q overlay picker */}
        {picker && (
          <div
            onClick={() => setPicker(false)}
            style={{
              position: "absolute", inset: 0,
              background: "color-mix(in oklab, var(--ink) 40%, transparent)",
              backdropFilter: "blur(6px)",
              display: "grid", placeItems: "center",
              zIndex: 30,
              animation: "popIn 0.16s",
            }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: "var(--bg-3)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              padding: 12,
              width: "min(92%, 440px)",
              boxShadow: "0 30px 60px -20px rgba(0,0,0,0.4)",
              maxHeight: "85%",
              overflowY: "auto",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Jump to node</span>
                <span style={{ display: "flex", gap: 4 }}>
                  <span className="kbd">Ctrl</span><span className="kbd">Q</span>
                </span>
              </div>
              {/* Tabs */}
              <div style={{
                display: "flex", gap: 4, marginBottom: 10,
                padding: 3, background: "var(--bg-2)",
                borderRadius: 8, fontSize: 12, fontFamily: "var(--mono)",
              }}>
                {[
                  { id: "list", label: "List" },
                  { id: "tree", label: "Tree" },
                ].map(t => (
                  <button key={t.id}
                    onClick={() => setPickerTab(t.id)}
                    style={{
                      flex: 1, padding: "6px 8px", borderRadius: 6, border: "none",
                      background: pickerTab === t.id ? "var(--bg-3)" : "transparent",
                      color: pickerTab === t.id ? "var(--ink)" : "var(--ink-3)",
                      boxShadow: pickerTab === t.id ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                      cursor: "pointer", fontFamily: "inherit", fontSize: "inherit",
                    }}>{t.label}</button>
                ))}
              </div>

              {pickerTab === "list" && (
                <>
                  {Object.values(trees).map(t => (
                    <div key={t.id} style={{ marginBottom: 10 }}>
                      <div style={{
                        fontFamily: "var(--mono)", fontSize: 9, color: "var(--ink-3)",
                        letterSpacing: "0.1em", textTransform: "uppercase",
                        padding: "4px 6px", display: "flex", alignItems: "center", gap: 6,
                      }}>
                        {t.name}
                        {t.id === activeTreeId && <span style={{ color: "var(--coral)" }}>· active</span>}
                      </div>
                      {Object.values(t.nodes).map(n => (
                        <div key={n.id}
                          onClick={() => jumpTo(t.id, n.id)}
                          style={{
                            padding: "8px 10px",
                            paddingLeft: 12 + n.depth * 16,
                            borderRadius: 8, fontSize: 13,
                            color: (t.id === activeTreeId && n.id === activeNodeId) ? "var(--bg)" : "var(--ink)",
                            background: (t.id === activeTreeId && n.id === activeNodeId) ? "var(--teal)" : "transparent",
                            display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                          }}
                          onMouseEnter={(e) => { if (!(t.id === activeTreeId && n.id === activeNodeId)) e.currentTarget.style.background = "var(--bg-2)"; }}
                          onMouseLeave={(e) => { if (!(t.id === activeTreeId && n.id === activeNodeId)) e.currentTarget.style.background = "transparent"; }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%",
                            background: n.depth === 0 ? "var(--ink)" : n.depth === 1 ? "var(--coral)" : "var(--lilac)" }}></span>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</span>
                          {n.parentId === null && <span style={{ fontFamily: "var(--mono)", fontSize: 9, opacity: 0.6 }}>root</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                  <button onClick={() => setCreatingNew(true)} style={{
                    width: "100%", padding: "10px",
                    border: "1px dashed var(--line)", borderRadius: 8,
                    background: "transparent", color: "var(--ink-2)",
                    fontFamily: "inherit", fontSize: 12,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <path d="M8 3 V13 M3 8 H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                    Start a new conversation
                  </button>
                </>
              )}

              {pickerTab === "tree" && (
                <div style={{
                  position: "relative", height: 280,
                  background: "color-mix(in oklab, var(--bg-2) 60%, var(--bg-3))",
                  borderRadius: 10, border: "1px solid var(--line)",
                  overflow: "hidden",
                }}>
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                    {Object.values(activeTree.nodes).map(n => {
                      if (!n.parentId) return null;
                      const a = treeLayout.positions[n.parentId];
                      const b = treeLayout.positions[n.id];
                      if (!a || !b) return null;
                      const cy = (a.y + b.y) / 2;
                      const d = `M ${a.x} ${a.y} C ${a.x} ${cy}, ${b.x} ${cy}, ${b.x} ${b.y}`;
                      return <path key={n.id} d={d} fill="none" stroke="var(--ink)" strokeOpacity="0.18" strokeWidth="1" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>;
                    })}
                  </svg>
                  {Object.values(activeTree.nodes).map(n => {
                    const pos = treeLayout.positions[n.id]; if (!pos) return null;
                    const isCurrent = n.id === activeNodeId;
                    const color = n.depth === 0 ? "var(--ink)" : n.depth === 1 ? "var(--coral)" : "var(--lilac)";
                    return (
                      <div key={n.id} onClick={() => jumpTo(activeTreeId, n.id)} style={{
                        position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`,
                        transform: "translate(-50%, -50%)", cursor: "pointer",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                        zIndex: 2,
                      }}>
                        <span style={{
                          width: isCurrent ? 20 : 13, height: isCurrent ? 20 : 13,
                          borderRadius: "50%", background: color,
                          border: `${isCurrent ? 3 : 2}px solid var(--bg-3)`,
                          boxShadow: isCurrent
                            ? `0 0 0 3px color-mix(in oklab, ${color} 25%, transparent)`
                            : `0 1px 2px rgba(22,20,19,0.12)`,
                        }}></span>
                        <span style={{
                          fontSize: 9, color: isCurrent ? "white" : "var(--ink)",
                          background: isCurrent ? color : "color-mix(in oklab, var(--bg-3) 80%, transparent)",
                          padding: isCurrent ? "1px 7px" : "1px 5px",
                          borderRadius: 5, fontWeight: isCurrent ? 600 : 500,
                          whiteSpace: "nowrap", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {n.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* "Start new conversation" modal */}
        {creatingNew && (
          <div onClick={() => setCreatingNew(false)} style={{
            position: "absolute", inset: 0,
            background: "color-mix(in oklab, var(--ink) 40%, transparent)",
            backdropFilter: "blur(6px)",
            display: "grid", placeItems: "center", zIndex: 40,
            animation: "popIn 0.16s",
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: "var(--bg-3)", border: "1px solid var(--line)",
              borderRadius: 14, padding: 18,
              width: "min(92%, 460px)",
              boxShadow: "0 30px 60px -20px rgba(0,0,0,0.4)",
            }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 4 }}>Start a new tree</div>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-2)" }}>Each conversation is its own tree. Pick a starter or write your own.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {STARTERS.map((s, i) => (
                  <div key={i} onClick={() => createNewTree(s)} style={{
                    padding: "12px 14px",
                    border: "1px solid var(--line)", borderRadius: 10,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-2)"; e.currentTarget.style.borderColor = "var(--coral)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--line)"; }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: ["var(--coral)", "var(--teal)", "var(--lilac)"][i % 3] }}></span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{s.root.label}</div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 3 L11 8 L5 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                ))}
              </div>
              <button onClick={() => setCreatingNew(false)} style={{
                marginTop: 14, width: "100%", padding: 10,
                background: "transparent", border: "none",
                color: "var(--ink-3)", fontSize: 12, cursor: "pointer",
              }}>Cancel</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

window.LiveDemo = LiveDemo;
