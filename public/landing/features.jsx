// ============================================================
// Scroll-pinned feature stories with camera zoom animations.
// ============================================================

const useScrollProgress = (ref) => {
  const [p, setP] = React.useState(0);
  React.useEffect(() => {
    if (!ref.current) return;
    const onScroll = () => {
      const el = ref.current; if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = rect.height - vh;
      if (total <= 0) { setP(0); return; }
      const scrolled = Math.min(Math.max(-rect.top, 0), total);
      setP(scrolled / total);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref]);
  return p;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const between = (p, a, b) => clamp01((p - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

// Mock-cursor shape
const Cursor = ({ x, y, opacity = 1 }) => (
  <div className="mockcursor" style={{ left: `${x}%`, top: `${y}%`, opacity }}>
    <svg width="20" height="20" viewBox="0 0 20 20">
      <path d="M3 2 L3 16 L7 12.5 L9.5 18 L11.7 17.2 L9 12 L14 12 Z"
        fill="var(--ink)" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  </div>
);

// Reusable mini-tree (positioned absolutely, scaled by camera)
// Uses curved Bezier paths so lines never visually cut through nodes.
const MiniTree = ({ nodes, links, currentId, sproutId }) => (
  <div className="mini-tree">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      {links.map(([f, t], i) => {
        const a = nodes.find(n => n.id === f);
        const b = nodes.find(n => n.id === t);
        if (!a || !b) return null;
        const cy = (a.y + b.y) / 2;
        const d = `M ${a.x} ${a.y} C ${a.x} ${cy}, ${b.x} ${cy}, ${b.x} ${b.y}`;
        const isNew = t === sproutId;
        return (
          <path key={i} d={d} fill="none"
            stroke={isNew ? "var(--coral)" : "var(--ink)"}
            strokeWidth="1"
            strokeOpacity={isNew ? 1 : 0.18}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={isNew ? "2 2" : "none"}
            style={isNew ? { animation: "dash 1.2s linear infinite" } : null}
          />
        );
      })}
    </svg>
    {nodes.map(n => (
      <div key={n.id} className={`mt-node ${n.id === currentId ? "current" : ""} ${n.id === sproutId ? "appearing" : ""}`}
        style={{ left: `${n.x}%`, top: `${n.y}%`, color: n.color }}>
        <span className="mt-dot" style={{ background: n.color }}></span>
        <span className="mt-label">{n.label}</span>
      </div>
    ))}
  </div>
);

// ==================================================================
// FEATURE 1 — Branch with camera zoom
// ==================================================================
const FeatureBranch = () => {
  const trackRef = React.useRef(null);
  const p = useScrollProgress(trackRef);

  // Phases:
  // 0.00-0.10 list builds
  // 0.10-0.24 cursor moves to "Weight training", selection forms
  // 0.24-0.42 inline ctx menu appears next to text
  // 0.42-0.50 click "Branch tree" → ZOOM OUT (chat shrinks, tree appears)
  // 0.50-0.60 new node sprouts on the tree
  // 0.60-0.68 ZOOM IN to new branch (empty + input with quote chip)
  // 0.68-0.82 typing animation in input field
  // 0.82-0.88 cursor moves to Send, click
  // 0.88-0.94 user bubble appears with quote + typed text
  // 0.94-1.00 assistant response appears

  const phShowList    = between(p, 0.00, 0.10);
  const phSelect      = between(p, 0.12, 0.24);
  const phMenu        = p > 0.26 && p < 0.50;
  const phHiliteBtn   = between(p, 0.36, 0.44);
  const phZoomOut     = between(p, 0.42, 0.55);
  const phSprout      = between(p, 0.52, 0.62);
  const phZoomIn      = between(p, 0.60, 0.72);
  const phTyping      = between(p, 0.70, 0.82);
  const phSendCursor  = between(p, 0.82, 0.88);
  const phUserBubble  = p > 0.88;
  const phAssistant   = p > 0.94;

  // Draft text typed letter-by-letter
  const DRAFT_TEXT = "what's the best way to start?";
  const typedText = DRAFT_TEXT.slice(0, Math.floor(DRAFT_TEXT.length * phTyping));
  const showCaret = phZoomIn > 0.6 && !phUserBubble;

  // Camera state — controls which scene is in focus
  // 0 = main chat, 1 = tree map, 2 = new branch
  const sceneA_opacity = 1 - phZoomOut;          // chat fades during zoom-out
  const sceneA_scale   = lerp(1, 0.4, phZoomOut);
  const sceneB_opacity = phZoomOut * (1 - phZoomIn);
  const sceneB_scale   = lerp(0.6, 1, phZoomOut) * lerp(1, 2.2, phZoomIn);
  const sceneC_opacity = phZoomIn;
  const sceneC_scale   = lerp(0.45, 1, phZoomIn);

  // Tree-map nodes for sprout animation
  const treeNodes = [
    { id: "root", x: 50, y: 22, color: "var(--ink)", label: "workouts overview" },
    { id: "a",    x: 22, y: 60, color: "var(--coral)", label: "weight training" },
    { id: "b",    x: 50, y: 60, color: "var(--ink)", label: "yoga" },
    { id: "c",    x: 78, y: 60, color: "var(--teal)", label: "swimming" },
  ];
  const treeLinks = [["root","a"],["root","b"],["root","c"]];

  return (
    <section className="feature" id="branch">
      <div className="pin-track" ref={trackRef}>
        <div className="pin">
          <div className="copy-col">
            <span className="eyebrow"><span className="dot"></span>01 — Branch the tree</span>
            <h2>Don't lose your <em>train of thought</em>.</h2>
            <p>Highlight any sentence in any reply. Branch off into a side conversation about just that idea — without burning the context of where you started.</p>
            <p>Each branch is its own thread. The trunk keeps its shape.</p>
            <div className="kbd-line">
              <span>Try it:</span>
              <span className="kbd">⌘</span><span>+</span><span className="kbd">B</span>
              <span>· or right-click → branch</span>
            </div>
          </div>

          <div className="stage-col">
            <div className="stage-head">
              <div className="dots"><i></i><i></i><i></i></div>
              <span>cogninode — branching demo</span>
            </div>

            <div className="stage-body" style={{ position: "relative" }}>
              {/* SCENE A: main chat */}
              <div style={{
                position: "absolute", inset: 0,
                opacity: sceneA_opacity,
                transform: `scale(${sceneA_scale})`,
                transformOrigin: "30% 60%",
                transition: "opacity 0.4s, transform 0.6s cubic-bezier(0.65,0,0.35,1)",
                padding: "22px",
                display: "flex", flexDirection: "column", gap: 10,
              }}>
                <div className="bubble user">What are the different forms of workouts?</div>
                <div className="bubble assistant" style={{ position: "relative", opacity: phShowList || sceneA_opacity, transition: "opacity 0.3s", maxWidth: "92%" }}>
                  <div className="meta">main thread · 142 tokens</div>
                  Here are four common forms:
                  <ol style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.8 }}>
                    <li>
                      <span className={`sent ${phSelect > 0.4 ? "target" : ""}`} style={{
                        background: phSelect > 0 && phSelect < 0.4 ? `color-mix(in oklab, var(--coral-soft) ${phSelect * 100}%, transparent)` : undefined,
                      }} id="wt-target">
                        Weight training
                      </span>{" "}— resistance work for strength.
                      {/* Inline context menu: positioned right under the highlighted text */}
                      {phMenu && (
                        <div className="ctx-pop" style={{ left: "0", top: "32px" }}>
                          <span className="tail"></span>
                          <button className={phHiliteBtn > 0.4 ? "hilite primary" : ""}>
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                              <circle cx="8" cy="3" r="1.8" fill="currentColor"/>
                              <circle cx="3" cy="13" r="1.8" fill="currentColor"/>
                              <circle cx="13" cy="13" r="1.8" fill="currentColor"/>
                              <path d="M8 4.5 L3 11.5 M8 4.5 L13 11.5" stroke="currentColor" strokeWidth="1.3"/>
                            </svg>
                            Branch tree
                            <span className="shortcut">⌘B</span>
                          </button>
                          <button>Reflect on this<span className="shortcut">⌘R</span></button>
                          <button>Copy<span className="shortcut">⌘C</span></button>
                        </div>
                      )}
                    </li>
                    <li>Yoga — flexibility, breath, balance.</li>
                    <li>HIIT — short bursts of intensity.</li>
                    <li>Swimming — full-body, low-impact.</li>
                  </ol>
                </div>
                {/* Cursor positioned over the highlighted phrase */}
                <Cursor
                  x={phSelect < 0.5 ? lerp(70, 18, phSelect) : 18 + (phHiliteBtn > 0.4 ? 5 : 0)}
                  y={phSelect < 0.5 ? lerp(80, 32, phSelect) : (phMenu ? 50 : 32)}
                  opacity={p < 0.04 || sceneA_opacity < 0.4 ? 0 : 1}
                />
              </div>

              {/* SCENE B: tree map (pull-back view) */}
              <div style={{
                position: "absolute", inset: 0,
                opacity: sceneB_opacity,
                transform: `scale(${sceneB_scale})`,
                transformOrigin: "22% 60%",  // zooms into the "weight training" node
                transition: "opacity 0.4s, transform 0.6s cubic-bezier(0.65,0,0.35,1)",
                pointerEvents: "none",
              }}>
                <div className="scene-label" style={{ position: "absolute" }}>Tree map</div>
                <MiniTree
                  nodes={[
                    ...treeNodes,
                    ...(phSprout > 0 ? [{ id: "a1", x: 22, y: 88, color: "var(--coral)", label: "progressive overload?" }] : [])
                  ]}
                  links={[...treeLinks, ...(phSprout > 0 ? [["a","a1"]] : [])]}
                  currentId={phZoomIn > 0.5 ? "a1" : "a"}
                  sproutId={phSprout > 0 && phSprout < 1 ? "a1" : null}
                />
              </div>

              {/* SCENE C: new branch */}
              <div style={{
                position: "absolute", inset: 0,
                opacity: sceneC_opacity,
                transform: `scale(${sceneC_scale})`,
                transformOrigin: "center center",
                transition: "opacity 0.5s, transform 0.6s cubic-bezier(0.65,0,0.35,1)",
                padding: "22px",
                display: "flex", flexDirection: "column", gap: 10,
                background: "color-mix(in oklab, var(--coral-soft) 18%, var(--bg-3))",
              }}>
                <div style={{
                  fontFamily: "var(--mono)", fontSize: 10, color: "var(--coral)",
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--coral)" }}></span>
                  New branch · "Weight training"
                  <span style={{ marginLeft: "auto", color: "var(--ink-3)" }}>parent context: 38t</span>
                </div>

                {/* User message bubble (appears after send) */}
                {phUserBubble && (
                  <div className="bubble user with-quote" style={{
                    maxWidth: "85%",
                    animation: "popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}>
                    <div className="quote-block">
                      <span className="quote-from">
                        <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                          <path d="M4 7 V11 H7 L5 14 M10 7 V11 H13 L11 14" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                        </svg>
                        Branched from parent
                      </span>
                      <span className="quote-text">Weight training</span>
                    </div>
                    <div>{DRAFT_TEXT}</div>
                  </div>
                )}

                {/* Assistant response */}
                {phAssistant && (
                  <div className="bubble assistant" style={{
                    maxWidth: "92%",
                    animation: "popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}>
                    <div className="meta">branch · only parent path loaded</div>
                    Start by picking ONE lever — usually load. Add 2.5–5 lb per week on your main lifts as long as form holds. Track weights, reps, and how it felt.
                  </div>
                )}

                {/* Input bar — visible from the moment we zoom in */}
                <div style={{
                  marginTop: "auto",
                  display: "flex", flexDirection: "column", gap: 6,
                  border: `1px solid ${phTyping > 0 && !phUserBubble ? "var(--coral)" : "var(--line)"}`,
                  borderRadius: 12,
                  padding: "8px",
                  background: "var(--bg-3)",
                  transition: "border-color 0.3s",
                  position: "relative",
                }}>
                  <div style={{ display: "flex", padding: "2px 4px" }}>
                    <span className="quote-chip">
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                        <path d="M4 7 V11 H7 L5 14 M10 7 V11 H13 L11 14" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                      </svg>
                      <span className="quote-chip-text">Weight training</span>
                      <button className="quote-chip-x" tabIndex={-1}>
                        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
                      </button>
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, padding: "2px 4px", alignItems: "center" }}>
                    <span style={{
                      flex: 1, fontSize: 13,
                      color: phUserBubble ? "var(--ink-3)" : (typedText ? "var(--ink)" : "var(--ink-3)"),
                      minHeight: 22, display: "inline-flex", alignItems: "center",
                    }}>
                      {phUserBubble ? "Add more context…" : (typedText || "Add more context…")}
                      {showCaret && !phUserBubble && (
                        <span style={{
                          display: "inline-block",
                          width: 1.5, height: 14, marginLeft: 2,
                          background: "var(--coral)",
                          animation: "blink 1s steps(2) infinite",
                        }}></span>
                      )}
                    </span>
                    <span style={{
                      background: phSendCursor > 0.4 ? "#ff4520" : "var(--coral)",
                      color: "white", padding: "6px 12px", borderRadius: 8, fontSize: 12,
                      transform: phSendCursor > 0.4 ? "scale(0.94)" : "scale(1)",
                      transition: "transform 0.2s, background 0.2s",
                    }}>Send</span>
                  </div>
                  {/* Cursor over Send button during phSendCursor */}
                  {phSendCursor > 0 && !phUserBubble && (
                    <Cursor x={88} y={70} opacity={1} />
                  )}
                </div>
              </div>
            </div>
            <div className="progress"><span style={{ transform: `scaleX(${p})` }}></span></div>
          </div>
        </div>
      </div>
    </section>
  );
};

// ==================================================================
// FEATURE 2 — Navigate (Ctrl+Q: list OR zoom-out tree)
// ==================================================================
const FeatureNavigate = () => {
  const trackRef = React.useRef(null);
  const p = useScrollProgress(trackRef);

  // 0.00-0.12 chat view of deep branch
  // 0.12-0.22 Ctrl+Q list opens
  // 0.22-0.38 cursor moves to "View tree" toggle, clicks
  // 0.38-0.55 ZOOM OUT to visual tree (list dismisses)
  // 0.55-0.72 cursor flies to root node, hovers
  // 0.72-0.85 click → ZOOM IN to that node's conversation
  // 0.85-1.00 root convo visible

  const phListOpen   = p > 0.12 && p < 0.42;
  const phHoverTreeBtn = between(p, 0.22, 0.32);
  const phZoomOut    = between(p, 0.38, 0.55);
  const phHoverRoot  = p > 0.55 && p < 0.78;
  const phZoomIn     = between(p, 0.78, 0.94);
  const phShowRoot   = p > 0.88;

  // Scene scaling — A: chat (deep), B: tree map, C: root chat
  const sceneA_opacity = 1 - phZoomOut;
  const sceneA_scale   = lerp(1, 0.35, phZoomOut);
  const sceneB_opacity = phZoomOut * (1 - phZoomIn);
  const sceneB_scale   = lerp(0.5, 1, phZoomOut) * lerp(1, 2.4, phZoomIn);
  const sceneC_opacity = phZoomIn;
  const sceneC_scale   = lerp(0.4, 1, phZoomIn);

  // Tree nodes
  const treeNodes = [
    { id: "root", x: 50, y: 20, color: "var(--ink)", label: "workouts overview" },
    { id: "a",    x: 22, y: 56, color: "var(--coral)", label: "weight training" },
    { id: "b",    x: 50, y: 56, color: "var(--ink)", label: "yoga" },
    { id: "c",    x: 78, y: 56, color: "var(--teal)", label: "swimming" },
    { id: "a1",   x: 22, y: 88, color: "var(--coral)", label: "progressive overload" },
  ];
  const treeLinks = [["root","a"],["root","b"],["root","c"],["a","a1"]];

  // Camera cursor — over root node when hovering
  const treeCursor = phHoverRoot ? { x: 50, y: 20 } : { x: 22, y: 88 };

  return (
    <section className="feature teal" id="navigate">
      <div className="pin-track" ref={trackRef}>
        <div className="pin">
          <div className="stage-col">
            <div className="stage-head">
              <div className="dots"><i></i><i></i><i></i></div>
              <span>cogninode — navigate</span>
            </div>

            <div className="stage-body" style={{ position: "relative" }}>
              {/* SCENE A: deep branch chat (with list overlay during phListOpen) */}
              <div style={{
                position: "absolute", inset: 0,
                opacity: sceneA_opacity,
                transform: `scale(${sceneA_scale})`,
                transformOrigin: "22% 88%",
                transition: "opacity 0.4s, transform 0.6s cubic-bezier(0.65,0,0.35,1)",
                padding: "22px",
                display: "flex", flexDirection: "column", gap: 10,
              }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Workouts › Weight training › Progressive overload
                </div>
                <div className="bubble user" style={{ maxWidth: "85%" }}>Tell me about progressive overload.</div>
                <div className="bubble assistant">
                  <div className="meta">branch · 96 tokens</div>
                  Gradually increase the demand on your muscles — load, volume, or frequency. The three levers each change one variable at a time.
                </div>

                {/* Ctrl+Q quick-list overlay */}
                {phListOpen && (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "color-mix(in oklab, var(--ink) 30%, transparent)",
                    backdropFilter: "blur(4px)",
                    display: "grid", placeItems: "center",
                    animation: "popIn 0.18s",
                  }}>
                    <div style={{
                      background: "var(--bg-3)",
                      border: "1px solid var(--line)",
                      borderRadius: 14,
                      padding: 12,
                      width: "min(86%, 320px)",
                      boxShadow: "0 24px 50px -20px rgba(0,0,0,0.35)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Jump to node</span>
                        <span style={{ display: "flex", gap: 4 }}>
                          <span className="kbd">Ctrl</span><span className="kbd">Q</span>
                        </span>
                      </div>
                      {/* Tab strip: List | Tree */}
                      <div style={{
                        display: "flex", gap: 4, marginBottom: 10,
                        padding: 3, background: "var(--bg-2)",
                        borderRadius: 8, fontSize: 11,
                        fontFamily: "var(--mono)", letterSpacing: "0.04em",
                      }}>
                        <span style={{ flex: 1, textAlign: "center", padding: "6px 8px", borderRadius: 6, background: phHoverTreeBtn > 0.4 ? "transparent" : "var(--bg-3)", color: phHoverTreeBtn > 0.4 ? "var(--ink-3)" : "var(--ink)", boxShadow: phHoverTreeBtn > 0.4 ? "none" : "0 1px 2px rgba(0,0,0,0.05)" }}>List</span>
                        <span style={{ flex: 1, textAlign: "center", padding: "6px 8px", borderRadius: 6, background: phHoverTreeBtn > 0.4 ? "var(--teal)" : "transparent", color: phHoverTreeBtn > 0.4 ? "white" : "var(--ink-3)", boxShadow: phHoverTreeBtn > 0.4 ? "0 1px 2px rgba(0,0,0,0.1)" : "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="3" r="1.6" fill="currentColor"/><circle cx="3" cy="11" r="1.6" fill="currentColor"/><circle cx="13" cy="11" r="1.6" fill="currentColor"/><path d="M8 4.5 L3 9.5 M8 4.5 L13 9.5" stroke="currentColor" strokeWidth="1.2"/></svg>
                          View tree
                        </span>
                      </div>
                      {[
                        { label: "workouts overview", note: "root", color: "var(--ink)" },
                        { label: "weight training", color: "var(--coral)" },
                        { label: "yoga", color: "var(--ink-2)" },
                        { label: "swimming", color: "var(--teal)" },
                        { label: "progressive overload", note: "current", color: "var(--coral)" },
                      ].map((row, i) => (
                        <div key={i} style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          fontSize: 12,
                          color: row.note === "current" ? "var(--bg)" : "var(--ink)",
                          background: row.note === "current" ? "var(--teal)" : "transparent",
                          display: "flex", alignItems: "center", gap: 10,
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: row.color }}></span>
                          {row.label}
                          {row.note && <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.1em" }}>{row.note}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Cursor heading to "View tree" tab */}
                <Cursor
                  x={phHoverTreeBtn < 0.4 ? lerp(80, 70, phHoverTreeBtn / 0.4) : 70}
                  y={phHoverTreeBtn < 0.4 ? lerp(80, 35, phHoverTreeBtn / 0.4) : 35}
                  opacity={phListOpen && p > 0.18 ? 1 : 0}
                />
              </div>

              {/* SCENE B: tree map */}
              <div style={{
                position: "absolute", inset: 0,
                opacity: sceneB_opacity,
                transform: `scale(${sceneB_scale})`,
                transformOrigin: "50% 20%", // zoom-in to root
                transition: "opacity 0.4s, transform 0.6s cubic-bezier(0.65,0,0.35,1)",
              }}>
                <span className="scene-label">Tree map</span>
                <MiniTree nodes={treeNodes} links={treeLinks} currentId={phHoverRoot ? "root" : "a1"} />
                <Cursor x={treeCursor.x} y={treeCursor.y} opacity={sceneB_opacity > 0.5 ? 1 : 0} />
              </div>

              {/* SCENE C: root chat */}
              <div style={{
                position: "absolute", inset: 0,
                opacity: sceneC_opacity,
                transform: `scale(${sceneC_scale})`,
                transformOrigin: "center center",
                transition: "opacity 0.4s, transform 0.6s cubic-bezier(0.65,0,0.35,1)",
                padding: "22px",
                display: "flex", flexDirection: "column", gap: 10,
                background: "color-mix(in oklab, var(--teal-soft) 12%, var(--bg-3))",
              }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--teal)", letterSpacing: "0.1em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--teal)" }}></span>
                  Now at root · workouts overview
                </div>
                <div className="bubble user" style={{ maxWidth: "85%" }}>What are the different forms of workouts?</div>
                <div className="bubble assistant" style={{ opacity: phShowRoot ? 1 : 0.7, transition: "opacity 0.3s" }}>
                  <div className="meta">root · 142 tokens</div>
                  Weight training, yoga, HIIT, swimming — each trains a different system. Pick the one that fits your goal.
                </div>
              </div>
            </div>
            <div className="progress"><span style={{ transform: `scaleX(${p})` }}></span></div>
          </div>

          <div className="copy-col">
            <span className="eyebrow teal"><span className="dot"></span>02 — Jump anywhere</span>
            <h2>Every thought has <em>a home</em>.</h2>
            <p>Hit <span className="kbd">Ctrl</span> <span className="kbd">Q</span> for a quick list of every node you've touched. Want to see the shape of your thinking? Toggle to the <b>tree view</b> and pick a node — the camera flies you in.</p>
            <p>The model only carries the path you're standing on. That's the token saving.</p>
          </div>
        </div>
      </div>
    </section>
  );
};

// ==================================================================
// FEATURE 3 — Reflect (live editing, tree stays intact)
// ==================================================================
const FeatureReflect = () => {
  const trackRef = React.useRef(null);
  const p = useScrollProgress(trackRef);

  // 0.00-0.12 conversation visible (with tree sidebar)
  // 0.12-0.22 cursor selects user prompt, ✕ handle appears
  // 0.22-0.30 click → prompt strikethrough then collapses
  // 0.30-0.42 cursor selects filler 1 ("Great question!")
  // 0.42-0.50 click → collapses
  // 0.50-0.62 cursor selects filler 2 (sign-off)
  // 0.62-0.70 click → collapses
  // 0.70-0.85 result reads as a clean note; tree sidebar still shows node intact
  // 0.85-1.00 zoom-in subtle on note + "saved as note" toast

  const phRevealUser  = between(p, 0.08, 0.18);
  const phUserDeleted = p > 0.26;
  const phFiller1     = between(p, 0.30, 0.40);
  const phF1Deleted   = p > 0.46;
  const phFiller2     = between(p, 0.50, 0.60);
  const phF2Deleted   = p > 0.66;
  const phNoteMode    = p > 0.72;

  // Cursor position — relative to right pane (the chat)
  const cursor = (() => {
    if (p < 0.10) return { x: 80, y: 90, opacity: 0 };
    if (p < 0.22) {
      // moves to user bubble
      const t = between(p, 0.10, 0.22);
      return { x: lerp(80, 45, t), y: lerp(85, 22, t), opacity: 1 };
    }
    if (p < 0.30) return { x: 45, y: 22, opacity: 1 };
    if (p < 0.42) {
      const t = between(p, 0.30, 0.42);
      return { x: lerp(45, 38, t), y: lerp(22, 44, t), opacity: 1 };
    }
    if (p < 0.50) return { x: 38, y: 44, opacity: 1 };
    if (p < 0.62) {
      const t = between(p, 0.50, 0.62);
      return { x: lerp(38, 42, t), y: lerp(44, 78, t), opacity: 1 };
    }
    if (p < 0.70) return { x: 42, y: 78, opacity: 1 };
    return { x: 42, y: 78, opacity: 0 };
  })();

  // Hovering states for ✕ handle visibility
  const handleOnUser  = !phUserDeleted && p > 0.16 && p < 0.30;
  const handleOnF1    = !phF1Deleted && p > 0.36 && p < 0.50;
  const handleOnF2    = !phF2Deleted && p > 0.56 && p < 0.70;

  // Tree sidebar — node stays the same throughout
  const treeNodes = [
    { id: "root", x: 50, y: 18, color: "var(--ink)", label: "workouts" },
    { id: "a",    x: 22, y: 50, color: "var(--coral)", label: "weight training" },
    { id: "b",    x: 50, y: 50, color: "var(--ink-3)", label: "yoga" },
    { id: "c",    x: 78, y: 50, color: "var(--teal)", label: "swimming" },
    { id: "a1",   x: 22, y: 84, color: "var(--lilac)", label: "overload" },
  ];
  const treeLinks = [["root","a"],["root","b"],["root","c"],["a","a1"]];

  return (
    <section className="feature lilac alt" id="reflect">
      <div className="pin-track" ref={trackRef}>
        <div className="pin">
          <div className="copy-col">
            <span className="eyebrow lilac"><span className="dot"></span>03 — Reflect</span>
            <h2>Trim what doesn't <em>serve you</em>.</h2>
            <p>Edit any line out of the model's reply — the chatty intros, the boilerplate sign-offs, even your own prompt. What's left becomes a clean note.</p>
            <p>The node stays exactly where it is in the tree. Your thinking, distilled.</p>
            <div className="kbd-line">
              <span>Click any line</span><span>→</span><span className="kbd">×</span><span>to reflect</span>
            </div>
          </div>

          <div className="stage-col">
            <div className="stage-head">
              <div className="dots"><i></i><i></i><i></i></div>
              <span>{phNoteMode ? "cogninode — note" : "cogninode — reflect"}</span>
            </div>

            <div className="stage-body" style={{ position: "relative", overflow: "hidden" }}>
              {/* Floating indicator showing the node is still intact in the tree */}
              <div style={{
                position: "absolute",
                top: 14, right: 14,
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 12px",
                background: phNoteMode ? "var(--lilac)" : "var(--bg-3)",
                border: `1px solid ${phNoteMode ? "var(--lilac)" : "var(--line)"}`,
                color: phNoteMode ? "white" : "var(--ink-2)",
                borderRadius: 999,
                fontFamily: "var(--mono)", fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                transition: "all 0.4s",
                zIndex: 5,
                boxShadow: phNoteMode
                  ? "0 6px 18px -6px color-mix(in oklab, var(--lilac) 60%, transparent)"
                  : "0 2px 6px rgba(22,20,19,0.06)",
              }}>
                {phNoteMode ? (
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8 L7 12 L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="3" r="1.6" fill="currentColor"/>
                    <circle cx="3" cy="13" r="1.6" fill="currentColor"/>
                    <circle cx="13" cy="13" r="1.6" fill="currentColor"/>
                    <path d="M8 4.5 L3 11.5 M8 4.5 L13 11.5" stroke="currentColor" strokeWidth="1.4"/>
                  </svg>
                )}
                {phNoteMode ? "saved as note" : "node intact in tree"}
              </div>

              {/* Editable chat */}
              <div style={{ position: "relative", padding: "22px", height: "100%", overflow: "auto", background: phNoteMode ? "color-mix(in oklab, var(--lilac-soft) 14%, var(--bg-3))" : "var(--bg-3)", transition: "background 0.5s" }}>
                {phNoteMode && (
                  <div style={{
                    fontFamily: "var(--display)", fontSize: 22, fontWeight: 600,
                    letterSpacing: "-0.02em",
                    marginBottom: 12,
                    animation: "popIn 0.4s",
                  }}>Progressive overload</div>
                )}

                {/* User prompt */}
                <div className={`bubble user ${phUserDeleted ? "gone-bubble" : ""}`} style={{
                  maxWidth: "85%", fontSize: 13,
                  opacity: phUserDeleted ? 0 : (phRevealUser ? 1 : 0.4),
                  maxHeight: phUserDeleted ? 0 : 80,
                  marginBottom: phUserDeleted ? 0 : 10,
                  padding: phUserDeleted ? "0 14px" : "12px 14px",
                  borderColor: handleOnUser ? "var(--lilac)" : undefined,
                  outline: handleOnUser ? "2px solid var(--lilac)" : "none",
                  outlineOffset: 2,
                  transition: "opacity 0.4s, max-height 0.5s, margin-bottom 0.5s, padding 0.5s, outline 0.2s",
                  overflow: "hidden",
                  position: "relative",
                }}>
                  Tell me more about progressive overload in weight training.
                  {handleOnUser && (
                    <span className="del-handle" style={{ top: "-26px", right: 0 }}>
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
                      Reflect
                    </span>
                  )}
                </div>

                {/* Assistant response */}
                <div className="bubble assistant" style={{
                  background: phNoteMode ? "transparent" : undefined,
                  border: phNoteMode ? "none" : undefined,
                  padding: phNoteMode ? 0 : "12px 14px",
                  fontSize: 13,
                  lineHeight: 1.6,
                  maxWidth: "100%",
                  transition: "background 0.5s, border-color 0.5s, padding 0.5s",
                }}>
                  <div className="meta" style={{ opacity: phNoteMode ? 0 : 1, transition: "opacity 0.4s" }}>output · 184 tokens</div>

                  {/* Filler 1: chatty intro */}
                  <div style={{
                    position: "relative",
                    opacity: phF1Deleted ? 0 : 1,
                    maxHeight: phF1Deleted ? 0 : 60,
                    marginBottom: phF1Deleted ? 0 : 6,
                    overflow: "hidden",
                    transition: "opacity 0.5s, max-height 0.5s, margin-bottom 0.5s",
                  }}>
                    <span style={{
                      background: handleOnF1 ? "var(--lilac-soft)" : "transparent",
                      outline: handleOnF1 ? "2px solid var(--lilac)" : "none",
                      borderRadius: 3,
                      padding: "0 3px",
                      textDecoration: phFiller1 > 0.6 && !phF1Deleted ? "line-through" : "none",
                      transition: "background 0.2s, outline 0.2s",
                    }}>Great question! Progressive overload is a foundational principle.</span>
                    {handleOnF1 && (
                      <span className="del-handle" style={{ top: "-26px", left: 8 }}>
                        <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
                        Reflect
                      </span>
                    )}
                  </div>

                  {/* Keeper 1 */}
                  <div style={{ marginBottom: 8 }}>
                    <strong>What it is:</strong> gradually increasing demand on your muscles — a few percent more weight, reps, or volume each week.
                  </div>

                  {/* Keeper 2 */}
                  <div style={{ marginBottom: 8 }}>
                    <strong>Three levers:</strong>
                    <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                      <li>Load — more weight per rep</li>
                      <li>Volume — more reps or sets</li>
                      <li>Frequency — more sessions per week</li>
                    </ol>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <strong>Rule of thumb:</strong> change one lever at a time. Track it.
                  </div>

                  {/* Filler 2: sign-off */}
                  <div style={{
                    position: "relative",
                    opacity: phF2Deleted ? 0 : 1,
                    maxHeight: phF2Deleted ? 0 : 80,
                    overflow: "hidden",
                    transition: "opacity 0.5s, max-height 0.5s",
                  }}>
                    <span style={{
                      background: handleOnF2 ? "var(--lilac-soft)" : "transparent",
                      outline: handleOnF2 ? "2px solid var(--lilac)" : "none",
                      borderRadius: 3,
                      padding: "0 3px",
                      textDecoration: phFiller2 > 0.6 && !phF2Deleted ? "line-through" : "none",
                      transition: "background 0.2s, outline 0.2s",
                    }}>Hope this helps! Let me know if you'd like me to elaborate on any part.</span>
                    {handleOnF2 && (
                      <span className="del-handle" style={{ top: "-26px", left: 8 }}>
                        <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
                        Reflect
                      </span>
                    )}
                  </div>
                </div>

                <Cursor x={cursor.x} y={cursor.y} opacity={cursor.opacity} />
              </div>
            </div>
            <div className="progress"><span style={{ transform: `scaleX(${p})` }}></span></div>
          </div>
        </div>
      </div>
    </section>
  );
};

window.FeatureBranch = FeatureBranch;
window.FeatureNavigate = FeatureNavigate;
window.FeatureReflect = FeatureReflect;

// ==================================================================
// FEATURE 4 — Models (bring your own brain)
// ==================================================================

// Model registry — used by both the animation and the live demo.
// Glyphs are simple letters in colored circles, NOT real brand logos.
const MODELS = [
  { id: "claude",  name: "Claude",   glyph: "C", color: "#ff5e3a", tagline: "thoughtful · long-context" },
  { id: "gpt",     name: "GPT-4",    glyph: "G", color: "#161413", tagline: "broad · structured" },
  { id: "gemini",  name: "Gemini",   glyph: "G", color: "#7c5cff", tagline: "fast · multimodal" },
  { id: "llama",   name: "Llama 3",  glyph: "L", color: "#0e8a7b", tagline: "open · self-hostable" },
];

// Different "voices" for the same question
const MODEL_REPLIES = {
  claude:
    "There are four common forms. Weight training builds strength through resistance. Yoga blends flexibility, breath, and balance. HIIT delivers short bursts of high intensity. Swimming is full-body and low-impact.",
  gpt:
    "Workouts fall into these categories:\n1. Strength training — resistance work for muscle\n2. Cardiovascular — sustained heart-rate work\n3. Flexibility & mobility — yoga, stretching\n4. HIIT — interval-based intensity",
  gemini:
    "Four main types:\n• Weight training — strength\n• Yoga — mobility\n• HIIT — efficient cardio\n• Swimming — full-body endurance\n\nPick by your goal.",
  llama:
    "Workouts: (1) resistance training, (2) endurance/cardio, (3) mobility, (4) skill-based. Choose based on goal: build, last, move, or play.",
};

const ModelAvatar = ({ m, size = 22 }) => (
  <span className="model-dot" style={{
    width: size, height: size,
    background: m.color,
    fontSize: Math.round(size * 0.45),
  }}>{m.glyph}</span>
);

const FeatureModels = () => {
  const trackRef = React.useRef(null);
  const p = useScrollProgress(trackRef);

  // Phases:
  // 0.00-0.10 chat with Claude response visible
  // 0.10-0.22 cursor moves to model badge
  // 0.22-0.34 click → dropdown opens, hover GPT-4
  // 0.34-0.42 click GPT-4 → badge updates
  // 0.42-0.58 response regenerates (GPT-4 voice)
  // 0.58-0.70 cursor to badge, click → dropdown again
  // 0.70-0.80 hover Gemini, click
  // 0.80-1.00 response regenerates (Gemini voice)

  const phCursorToBadge1 = between(p, 0.10, 0.20);
  const phDropdown1      = p > 0.20 && p < 0.42;
  const phHilightGPT     = p > 0.30 && p < 0.42;
  const phPickGPT        = p > 0.40;
  const phCursorToBadge2 = between(p, 0.56, 0.66);
  const phDropdown2      = p > 0.66 && p < 0.82;
  const phHilightGemini  = p > 0.74 && p < 0.82;
  const phPickGemini     = p > 0.80;

  // Determine active model based on phase
  const activeModel = phPickGemini
    ? MODELS.find(m => m.id === "gemini")
    : phPickGPT
      ? MODELS.find(m => m.id === "gpt")
      : MODELS.find(m => m.id === "claude");

  // Determine response text shown (with typing-effect during regeneration)
  // Each regen window types the new reply letter by letter
  const replyState = (() => {
    if (phPickGemini && p > 0.80) {
      const t = between(p, 0.82, 0.95);
      const full = MODEL_REPLIES.gemini;
      return { text: full.slice(0, Math.floor(full.length * t)), regenerating: t < 1, model: "gemini" };
    }
    if (phPickGPT && p < 0.66) {
      const t = between(p, 0.42, 0.56);
      const full = MODEL_REPLIES.gpt;
      return { text: full.slice(0, Math.floor(full.length * t)), regenerating: t < 1, model: "gpt" };
    }
    if (phPickGPT && p >= 0.66) {
      return { text: MODEL_REPLIES.gpt, regenerating: false, model: "gpt" };
    }
    return { text: MODEL_REPLIES.claude, regenerating: false, model: "claude" };
  })();

  // Cursor position based on phase
  const cursor = (() => {
    if (p < 0.08) return { x: 80, y: 85, opacity: 0 };
    if (phCursorToBadge1 < 1 && p < 0.22) {
      return { x: lerp(80, 78, phCursorToBadge1), y: lerp(85, 14, phCursorToBadge1), opacity: 1 };
    }
    if (phDropdown1 && phHilightGPT) {
      return { x: lerp(78, 70, between(p, 0.28, 0.40)), y: lerp(14, 38, between(p, 0.28, 0.40)), opacity: 1 };
    }
    if (phDropdown1) return { x: 78, y: 22, opacity: 1 };
    if (phCursorToBadge2 < 1 && p < 0.66 && p > 0.50) {
      return { x: lerp(70, 78, phCursorToBadge2), y: lerp(38, 14, phCursorToBadge2), opacity: 1 };
    }
    if (phDropdown2 && phHilightGemini) {
      return { x: lerp(78, 70, between(p, 0.72, 0.80)), y: lerp(14, 46, between(p, 0.72, 0.80)), opacity: 1 };
    }
    if (phDropdown2) return { x: 78, y: 22, opacity: 1 };
    return { x: 70, y: 46, opacity: phPickGemini ? 0 : 1 };
  })();

  return (
    <section className="feature butter" id="models">
      <div className="pin-track" ref={trackRef}>
        <div className="pin">
          <div className="copy-col">
            <span className="eyebrow butter"><span className="dot"></span>04 — Bring your own brain</span>
            <h2>Use the AI <em>you trust</em>.</h2>
            <p>
              Claude, GPT, Gemini, Llama — even your own self-hosted model. Pick the
              brain per branch, or per node. Your tree stays put; the brain swaps.
            </p>
            <p>
              Compare answers, save the best, route hard questions to the model that
              gets them.
            </p>
            <div className="kbd-line">
              <span>One tree</span><span>·</span><span>many brains</span>
            </div>
          </div>

          <div className="stage-col">
            <div className="stage-head">
              <div className="dots"><i></i><i></i><i></i></div>
              <span>cogninode — model picker</span>
            </div>

            <div className="stage-body" style={{ position: "relative", padding: "22px", display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Toolbar with model badge */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                paddingBottom: 10, borderBottom: "1px solid var(--line)",
              }}>
                <div style={{
                  fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)",
                  letterSpacing: "0.1em", textTransform: "uppercase",
                }}>
                  Workouts overview
                </div>
                {/* Model badge */}
                <div style={{ position: "relative" }}>
                  <span className="model-badge" style={{
                    transform: ((phDropdown1 || phDropdown2) ? "scale(0.96)" : "scale(1)"),
                    borderColor: (phDropdown1 || phDropdown2) ? "var(--ink)" : undefined,
                  }}>
                    <ModelAvatar m={activeModel} size={14} />
                    {activeModel.name}
                    <svg className="caret" viewBox="0 0 16 16" fill="none">
                      <path d="M4 6 L8 10 L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </span>

                  {(phDropdown1 || phDropdown2) && (
                    <div className="model-dropdown" style={{ top: "calc(100% + 6px)", right: 0 }}>
                      {MODELS.map(m => {
                        const isActive = m.id === activeModel.id;
                        const isHilight =
                          (phDropdown1 && m.id === "gpt" && phHilightGPT) ||
                          (phDropdown2 && m.id === "gemini" && phHilightGemini);
                        return (
                          <div key={m.id} className={`model-row ${isActive ? "active" : ""} ${isHilight ? "hilite" : ""}`}>
                            <ModelAvatar m={m} size={22} />
                            <div className="model-meta">
                              <span className="model-name">{m.name}</span>
                              <span className="model-tagline">{m.tagline}</span>
                            </div>
                            <svg className="check" viewBox="0 0 16 16" fill="none">
                              <path d="M3 8 L7 12 L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                        );
                      })}
                      <div className="model-row connect">
                        <span className="model-dot">+</span>
                        <div className="model-meta">
                          <span className="model-name">Connect API key…</span>
                          <span className="model-tagline">openai, anthropic, openrouter</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Chat content */}
              <div className="bubble user" style={{ maxWidth: "85%" }}>
                What are the different forms of workouts?
              </div>

              <div className="bubble assistant" style={{ maxWidth: "94%", position: "relative" }}>
                <div className="meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ModelAvatar m={activeModel} size={12} />
                  <span>{activeModel.name}{replyState.regenerating ? " · generating…" : ""}</span>
                </div>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 14, minHeight: 100 }}>
                  {replyState.text}
                  {replyState.regenerating && (
                    <span style={{
                      display: "inline-block",
                      width: 1.5, height: 14, marginLeft: 2,
                      background: activeModel.color,
                      animation: "blink 1s steps(2) infinite",
                      verticalAlign: "middle",
                    }}></span>
                  )}
                </div>
              </div>

              <Cursor x={cursor.x} y={cursor.y} opacity={cursor.opacity} />
            </div>

            <div className="progress"><span style={{ transform: `scaleX(${p})` }}></span></div>
          </div>
        </div>
      </div>
    </section>
  );
};

window.MODELS = MODELS;
window.ModelAvatar = ModelAvatar;
window.FeatureModels = FeatureModels;
