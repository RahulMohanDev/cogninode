// Reusable cogninode logo glyph + animated hero tree

const Glyph = ({ size = 22, color = "currentColor", accent = "var(--coral)" }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="6" r="3.5" fill={color} />
    <circle cx="6" cy="20" r="3" fill={color} />
    <circle cx="16" cy="20" r="3" fill={accent} />
    <circle cx="26" cy="20" r="3" fill={color} />
    <circle cx="11" cy="28" r="2.2" fill={color} />
    <path d="M16 10 L6 17 M16 10 L16 17 M16 10 L26 17 M6 23 L11 26.2" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

// Animated tree that builds itself, used in the hero.
// NOTE: We animate the SVG `r` attribute + opacity (not <g> transform/scale)
// because Chrome has a long-standing bug where transform: scale() on <g>
// elements with a pixel transform-origin gets stuck at scale(0). Animating
// the radius attribute is reliable across browsers.
const HeroTree = () => {
  const [phase, setPhase] = React.useState(0);
  React.useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 250),
      setTimeout(() => setPhase(2), 700),
      setTimeout(() => setPhase(3), 1150),
      setTimeout(() => setPhase(4), 1600),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // 600x540 viewBox
  const N = {
    root: { x: 300, y: 70,  r: 26 },
    a:    { x: 130, y: 240, r: 20 },
    b:    { x: 300, y: 240, r: 20 },
    c:    { x: 470, y: 240, r: 20 },
    a1:   { x: 80,  y: 420, r: 14 },
    a2:   { x: 180, y: 420, r: 14 },
    c1:   { x: 470, y: 420, r: 14 },
  };

  const Line = ({ from, to, on, color = "var(--ink)" }) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    return (
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
        stroke={color} strokeWidth="1.6" strokeLinecap="round"
        strokeDasharray={len} strokeDashoffset={on ? 0 : len}
        style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)" }}
      />
    );
  };

  // Node animates via `r` attribute + `opacity` — both reliable on <circle>.
  const Node = ({ n, color, on, delay = 0 }) => (
    <circle
      cx={n.x} cy={n.y}
      r={on ? n.r : 0}
      fill={color}
      opacity={on ? 1 : 0}
      style={{
        transition: `r 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}ms, opacity 0.35s ${delay}ms`,
      }}
    />
  );

  return (
    <svg viewBox="0 0 600 540" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      {/* Connectors */}
      <Line from={N.root} to={N.a} on={phase >= 2} />
      <Line from={N.root} to={N.b} on={phase >= 2} />
      <Line from={N.root} to={N.c} on={phase >= 2} />
      <Line from={N.a} to={N.a1} on={phase >= 3} />
      <Line from={N.a} to={N.a2} on={phase >= 3} />
      <Line from={N.c} to={N.c1} on={phase >= 3} />

      {/* Nodes */}
      <Node n={N.root} color="var(--ink)"   on={phase >= 1} delay={0} />
      <Node n={N.a}    color="var(--coral)" on={phase >= 2} delay={80} />
      <Node n={N.b}    color="var(--ink)"   on={phase >= 2} delay={0} />
      <Node n={N.c}    color="var(--teal)"  on={phase >= 2} delay={160} />
      <Node n={N.a1}   color="var(--coral)" on={phase >= 3} delay={0} />
      <Node n={N.a2}   color="var(--lilac)" on={phase >= 3} delay={80} />
      <Node n={N.c1}   color="var(--teal)"  on={phase >= 3} delay={160} />

      {/* "branched here" callout */}
      {phase >= 4 && (
        <g style={{ opacity: 1 }}>
          <line x1={N.a.x - 50} y1={N.a.y - 60} x2={N.a.x - 8} y2={N.a.y - 8}
            stroke="var(--coral)" strokeWidth="1" strokeDasharray="3 3" />
          <rect x={N.a.x - 180} y={N.a.y - 88} width="130" height="32" rx="8" fill="var(--coral)" />
          <text x={N.a.x - 115} y={N.a.y - 67} textAnchor="middle"
            style={{ fontFamily: "var(--mono)", fontSize: 11, fill: "white", letterSpacing: "0.08em" }}>
            branched here
          </text>
        </g>
      )}
    </svg>
  );
};

window.Glyph = Glyph;
window.HeroTree = HeroTree;
