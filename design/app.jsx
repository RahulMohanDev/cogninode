// Main app: stitches everything together. Loaded after glyph.jsx, features.jsx, demo.jsx.

const { Glyph, HeroTree, FeatureBranch, FeatureNavigate, FeatureReflect, FeatureModels, MODELS, ModelAvatar, LiveDemo } = window;

const Nav = () => {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <nav className={`nav ${scrolled ? "scrolled" : ""}`}>
      <a href="#top" className="wm" style={{ textDecoration: "none", color: "inherit" }}>
        <span className="glyph"><Glyph size={22} color="var(--ink)" accent="var(--coral)"/></span>
        cogninode
      </a>
      <div className="links">
        <a href="#branch">Branch</a>
        <a href="#navigate">Navigate</a>
        <a href="#reflect">Reflect</a>
        <a href="#models">Models</a>
        <a href="#demo">Try it</a>
        <a href="app/login.html" className="btn-pill">Open app</a>
      </div>
    </nav>
  );
};

const Hero = () => (
  <section className="hero" id="top">
    <div className="hero-grid-bg"></div>
    <div className="hero-inner">
      <div className="hero-tree"><HeroTree /></div>
      <h1>
        Think with AI,<br/>
        <em>not</em> <span className="accent-c">at</span> it.
      </h1>
      <p className="tag">
        cogninode is a tree-shaped AI chat. Branch any idea, jump anywhere,
        and pay for tokens you actually use.
      </p>
      <div className="hero-ctas">
        <a href="app/login.html" className="btn-pill coral">Open the app
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8 H13 M9 4 L13 8 L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </a>
        <a href="#demo" className="btn-pill ghost">See it live</a>
      </div>
    </div>
    <div className="scroll-cue">
      <span>scroll</span>
      <span className="line"></span>
    </div>
  </section>
);

const Ticker = () => {
  const items = [
    "Branch any reply",
    "₹149/month for students",
    "Jump anywhere with ⌃Q",
    "Reflections become notes",
    "DeepSeek R1 for reasoning",
    "Context follows the path",
    "No more 'previously you said…'",
  ];
  const doubled = [...items, ...items];
  return (
    <div className="ticker">
      <div className="ticker-track">
        {doubled.map((t, i) => (
          <span key={i} className="ticker-item">
            <span className="star"></span>{t}
          </span>
        ))}
      </div>
    </div>
  );
};

const DemoSection = () => (
  <section className="demo-section" id="demo">
    <div className="demo-wrap">
      <div className="demo-head">
        <span className="eyebrow"><span className="dot"></span>Try it right here</span>
        <h2>A real conversation tree.<br/><em style={{fontFamily: "Instrument Serif, serif", fontStyle: "italic", fontWeight: 400, color: "var(--coral)"}}>Click any line to branch.</em></h2>
        <p>Tap a phrase. Hit <span className="kbd">Ctrl</span>+<span className="kbd">Q</span> to jump anywhere. Click the ✕ to reflect a line out of the note.</p>
      </div>
      <LiveDemo />
    </div>
  </section>
);

const CTA = () => {
  const [email, setEmail] = React.useState("");
  const [done, setDone] = React.useState(false);
  return (
    <section className="cta" id="waitlist">
      <div className="cta-deco-1"></div>
      <div className="cta-deco-2"></div>
      <div className="cta-deco-3"></div>
      <span className="eyebrow"><span className="dot"></span>Now open in India</span>
      <h2>One AI chat.<br/><em>Many minds.</em></h2>
      <p>cogninode is live. Sign up and get 400 free credits — more than a whole month of the free plan to explore with.</p>
      <form className={`waitlist ${done ? "done" : ""}`} onSubmit={(e) => { e.preventDefault(); if (email.includes("@")) setDone(true); }}>
        {!done ? (
          <>
            <input type="email" placeholder="you@iitb.ac.in or your email" value={email} onChange={(e) => setEmail(e.target.value)} required/>
            <button type="submit">Get early access
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8 H13 M9 4 L13 8 L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </>
        ) : (
          <span className="check">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8 L7 12 L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            You're on the list.
          </span>
        )}
      </form>
    </section>
  );
};

const Footer = () => (
  <footer>
    <div className="wm">
      <Glyph size={20} color="var(--ink)" accent="var(--coral)"/>
      cogninode
    </div>
    <div className="links">
      <a href="#branch">Branch</a>
      <a href="#navigate">Navigate</a>
      <a href="#reflect">Reflect</a>
      <a href="#models">Models</a>
      <a href="#demo">Demo</a>
      <a href="#waitlist">Waitlist</a>
    </div>
    <div>© 2026 cogninode · think in trees</div>
  </footer>
);

const App = () => (
  <>
    <Nav />
    <Hero />
    <Ticker />
    <FeatureBranch />
    <FeatureNavigate />
    <FeatureReflect />
    <FeatureModels />
    <DemoSection />
    <CTA />
    <Footer />
  </>
);

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
