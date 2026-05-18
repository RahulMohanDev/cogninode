// Shared across all pages: glyph, models, seed chats, sidebar, user menu, helpers.
// Loaded as a Babel script before the per-page entry script.

// ------------------------------------------------------------------
// Brand glyph (small tree mark)
// ------------------------------------------------------------------
const Glyph = ({ size = 22, color = "var(--ink)", accent = "var(--coral)" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M12 22 V13" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M12 13 L6 8" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M12 13 L18 8" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    <circle cx="12" cy="13" r="2.2" fill={accent}/>
    <circle cx="6" cy="6" r="2.6" fill={color}/>
    <circle cx="18" cy="6" r="2.6" fill={color}/>
    <circle cx="12" cy="22" r="1.4" fill={color}/>
  </svg>
);

// Larger decorative tree for auth/empty pages
const BigTree = ({ size = 420 }) => (
  <svg width={size} height={size} viewBox="0 0 200 200" fill="none">
    <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.9">
      <path d="M100 178 V120" />
      <path d="M100 120 L60 80" />
      <path d="M100 120 L140 80" />
      <path d="M60 80 L40 50" />
      <path d="M60 80 L70 44" />
      <path d="M140 80 L130 44" />
      <path d="M140 80 L162 50" />
      <path d="M130 44 L150 18" />
      <path d="M130 44 L120 14" />
    </g>
    <circle cx="100" cy="120" r="6" fill="var(--coral)"/>
    <circle cx="60" cy="80" r="5" fill="var(--teal)"/>
    <circle cx="140" cy="80" r="5" fill="var(--teal)"/>
    <circle cx="40" cy="50" r="4" fill="var(--lilac)"/>
    <circle cx="70" cy="44" r="4" fill="var(--lilac)"/>
    <circle cx="130" cy="44" r="4" fill="var(--lilac)"/>
    <circle cx="162" cy="50" r="4" fill="var(--lilac)"/>
    <circle cx="150" cy="18" r="3.4" fill="var(--butter)"/>
    <circle cx="120" cy="14" r="3.4" fill="var(--butter)"/>
    <circle cx="100" cy="178" r="3" fill="currentColor"/>
  </svg>
);

// ------------------------------------------------------------------
// Models — id, name, vendor, credits/message, color
// ------------------------------------------------------------------
const MODELS = [
  {
    id: "llama",  name: "Llama 3.1",        vendor: "Meta",
    tag: "free · open",         tier: 0,
    inputPricePerMTokenUsd: 0,     outputPricePerMTokenUsd: 0,
    color: "#6366f1", initials: "LL",
  },
  {
    id: "flash",  name: "Gemini Flash 2.0", vendor: "Google",
    tag: "budget · fast",        tier: 1,
    inputPricePerMTokenUsd: 0.10,  outputPricePerMTokenUsd: 0.40,
    color: "#0e8a7b", initials: "GF",
  },
  {
    id: "dsv3",   name: "DeepSeek V3",      vendor: "DeepSeek",
    tag: "budget · strong",      tier: 1,
    inputPricePerMTokenUsd: 0.32,  outputPricePerMTokenUsd: 0.89,
    color: "#374151", initials: "DS",
  },
  {
    id: "4omini", name: "GPT-4o Mini",      vendor: "OpenAI",
    tag: "value · reliable",     tier: 2,
    inputPricePerMTokenUsd: 0.165, outputPricePerMTokenUsd: 0.66,
    color: "#10a37f", initials: "4m",
  },
  {
    id: "dsr1",   name: "DeepSeek R1",      vendor: "DeepSeek",
    tag: "reasoning · maths",    tier: 2,
    inputPricePerMTokenUsd: 0.605, outputPricePerMTokenUsd: 2.41,
    color: "#1d4ed8", initials: "R1",
  },
  {
    id: "haiku",  name: "Claude Haiku 4.5", vendor: "Anthropic",
    tag: "mid · capable",        tier: 3,
    inputPricePerMTokenUsd: 1.10,  outputPricePerMTokenUsd: 5.50,
    color: "#d97757", initials: "CH",
  },
  {
    id: "gpt4o",  name: "GPT-4o",           vendor: "OpenAI",
    tag: "premium · versatile",  tier: 4,
    inputPricePerMTokenUsd: 2.75,  outputPricePerMTokenUsd: 11.00,
    color: "#10a37f", initials: "4o",
  },
  {
    id: "sonnet", name: "Claude Sonnet 4.5",vendor: "Anthropic",
    tag: "premium · top",        tier: 4,
    inputPricePerMTokenUsd: 3.30,  outputPricePerMTokenUsd: 16.50,
    color: "#b45309", initials: "CS",
  },
];
const getModel = (id) => MODELS.find(m => m.id === id) || MODELS[0];

// ------------------------------------------------------------------
// Credit math
// ------------------------------------------------------------------
// chars/4 is the standard approximation for most tokenizers.
function roughTokens(text) {
  return Math.ceil((text || "").length / 4);
}

// Central cost formula — returns USD directly. The user pays OpenRouter
// at list price; no margin, no ₹-conversion, no credit abstraction.
function calculateCostUsd(inputTokens, outputTokens, model) {
  if (!model || model.inputPricePerMTokenUsd === 0) return 0;
  return (inputTokens  * (model.inputPricePerMTokenUsd  || 0) / 1_000_000) +
         (outputTokens * (model.outputPricePerMTokenUsd || 0) / 1_000_000);
}

// Format a cost for display.
function formatCost(costUsd) {
  if (costUsd === 0)     return 'free';
  if (costUsd < 0.0001)  return '< $0.0001';
  if (costUsd < 0.01)    return '$' + costUsd.toFixed(4);
  return '$' + costUsd.toFixed(3);
}

// Estimate-display variant — prefixes with ~ for pre-send pills.
function formatEstimate(costUsd) {
  return costUsd === 0 ? '~free' : '~' + formatCost(costUsd);
}

// Pre-send helper: estimate USD cost from composer text + path msgs.
function estimateCostUsd(composerText, pathMessages, model) {
  const inputTok = roughTokens(composerText) +
    (pathMessages || []).reduce((s, m) => s + roughTokens(m.content), 0);
  return calculateCostUsd(inputTok, 550, model);
}

const ModelDot = ({ model, size = 16 }) => {
  const m = typeof model === "string" ? getModel(model) : model;
  return (
    <span
      className="m-dot"
      style={{
        width: size, height: size,
        background: m.color,
        fontSize: Math.max(7, size * 0.42),
      }}
    >{m.initials}</span>
  );
};

// ------------------------------------------------------------------
// User
// ------------------------------------------------------------------
const ME = {
  name: "You",
  defaultModelId: "flash",
};

// PLANS / TOPUPS aren't used in the OSS beta. Keep empty exports so any
// stale destructure doesn't crash, but no billing concepts in this build.
const PLANS = {};
const TOPUPS = [];

// ------------------------------------------------------------------
// Seed conversations.
// Each chat is a tree. Each node has: id, parentId, depth, label,
// messages: [{role: 'user'|'assistant', content, model?, credits?, quote?}]
// ------------------------------------------------------------------
const SEED = {
  chats: {
    c_japan: {
      id: "c_japan",
      title: "10-day Japan itinerary",
      created: "May 12",
      rootId: "n_japan_root",
      currentNodeId: "n_japan_kyoto",
      nodes: {
        n_japan_root: {
          id: "n_japan_root", parentId: null, depth: 0,
          label: "Plan a trip to Japan",
          messages: [
            { role: "user", content: "Help me plan a 10-day trip to Japan in late October — first time, mid-budget, no rental car." },
            { role: "assistant", model: "sonnet", credits: 2, content:
              "A balanced 10-day route hits three regions and uses the JR Pass for transit.\n\n" +
              "**Days 1–4 — Tokyo.** Modern megacity, easy entry. Day trip to **Nikko** or **Hakone** for a temple-and-onsen contrast.\n\n" +
              "**Days 5–8 — Kyoto.** Temples, gardens, geisha district. A side trip to **Nara** for the deer park.\n\n" +
              "**Days 9–10 — Osaka.** Street food capital and your exit point. Optional **Hiroshima/Miyajima** day trip via shinkansen.\n\n" +
              "Late October is peak autumn-leaf season — book ryokans early. Want me to drill into any region?",
            },
          ],
        },
        n_japan_kyoto: {
          id: "n_japan_kyoto", parentId: "n_japan_root", depth: 1,
          label: "Kyoto deep dive",
          messages: [
            { role: "user", quote: "Days 5–8 — Kyoto", content: "Tell me more about Kyoto. What are the must-do experiences and what to skip?" },
            { role: "assistant", model: "sonnet", credits: 2, content:
              "Kyoto rewards slow days. Pick **three temple clusters**, not all of them.\n\n" +
              "**Worth it.** Fushimi Inari at sunrise (no crowds), Arashiyama bamboo grove **before 8am**, a half-day in **Higashiyama** (Kiyomizu → Yasaka → Gion), and one quiet zen garden like **Ryōan-ji**.\n\n" +
              "**Skip or de-emphasize.** Kinkaku-ji is a 15-minute photo stop, not an afternoon. Avoid Pontocho on weekends.\n\n" +
              "**Eat.** Ichiran for ramen once, then go local — try **Nishiki Market** stalls and a kaiseki dinner one night.",
            },
            { role: "user", content: "How do I do Fushimi Inari at sunrise — is it actually empty?" },
            { role: "assistant", model: "sonnet", credits: 2, content:
              "Yes — arrive by **6:30am** in October (sunrise ~6:00) and you'll have the lower torii path nearly alone. The hike to the summit is ~2 hours round trip; most people quit at the Yotsutsuji viewpoint (45 min up) which is fine.\n\n" +
              "Wear real shoes — the upper trail is uneven stone. There's a small tea house near the top for matcha." },
          ],
        },
        n_japan_food: {
          id: "n_japan_food", parentId: "n_japan_kyoto", depth: 2,
          label: "Kaiseki vs izakaya night",
          messages: [
            { role: "user", quote: "kaiseki dinner one night", content: "What's the difference between kaiseki and izakaya, and which should I splurge on?" },
            { role: "assistant", model: "opus", credits: 5, content:
              "Kaiseki is a **multi-course seasonal tasting** — think 8–12 small plates following a strict progression (appetizer → sashimi → grilled → simmered → rice → sweet). Ritualized, quiet, often 2+ hours. Budget ¥15,000–30,000 / person.\n\n" +
              "Izakaya is the opposite: loud, casual, share plates with cold beer or sake. Order as you go. Budget ¥3,000–6,000 / person.\n\n" +
              "**Splurge on kaiseki once** — it's an experience you can't replicate at home. Do izakaya the other nights. **Gion Karyō** is a great mid-range kaiseki spot if you want a starter; book 2 weeks ahead." },
          ],
        },
        n_japan_nara: {
          id: "n_japan_nara", parentId: "n_japan_kyoto", depth: 2,
          label: "Nara day trip logistics",
          messages: [
            { role: "user", quote: "side trip to Nara for the deer park", content: "Can I do Nara as a half-day? What time should I leave Kyoto?" },
            { role: "assistant", model: "sonnet", credits: 2, content:
              "Half-day works if you start by **8am**. Take the JR Nara Line from Kyoto Station — 45 minutes, covered by JR Pass.\n\n" +
              "Hit **Nara Park → Tōdai-ji (the big Buddha) → Kasuga Taisha shrine**, in that order. The deer crowd at the park entrance — buy shika senbei (deer crackers) from a stand, not the deer (they will mug you for them).\n\n" +
              "Back in Kyoto by 2pm for an afternoon temple." },
          ],
        },
        n_japan_pass: {
          id: "n_japan_pass", parentId: "n_japan_root", depth: 1,
          label: "JR Pass — worth it?",
          messages: [
            { role: "user", quote: "uses the JR Pass for transit", content: "Is the 7-day JR Pass still worth it after the 2023 price hike?" },
            { role: "assistant", model: "gpt4o", credits: 1, content:
              "Marginally — you need to commit to long-distance rides. The 7-day pass is **¥50,000**. A single Tokyo → Kyoto round trip on shinkansen is ~¥27,000, so two long rides break even.\n\n" +
              "Your route (Tokyo → Kyoto → Hiroshima → Osaka → Tokyo) easily clears the threshold. **Buy it.** Activate it on day 4 in Tokyo, before your Kyoto leg." },
          ],
        },
      },
    },

    c_useState: {
      id: "c_useState",
      title: "Understanding useState",
      created: "May 11",
      rootId: "n_us_root",
      currentNodeId: "n_us_stale",
      nodes: {
        n_us_root: {
          id: "n_us_root", parentId: null, depth: 0,
          label: "React useState basics",
          messages: [
            { role: "user", content: "Explain useState in React — I keep getting weird behavior with stale values." },
            { role: "assistant", model: "sonnet", credits: 2, content:
              "**useState** is a hook for local component state.\n\n" +
              "```js\nconst [count, setCount] = useState(0);\nsetCount(count + 1); // triggers re-render\n```\n\n" +
              "Three things trip people up:\n\n" +
              "• **Stale closures** — handlers capture the value at the time they were defined.\n" +
              "• **Async batching** — multiple `setX` in the same event are batched; the next read of `x` still shows the old value until re-render.\n" +
              "• **Object identity** — `setUser({...user, name})` is fine, but `user.name = x; setUser(user)` won't re-render.\n\n" +
              "Tell me which one is biting you?",
            },
          ],
        },
        n_us_stale: {
          id: "n_us_stale", parentId: "n_us_root", depth: 1,
          label: "Stale closure fix",
          messages: [
            { role: "user", quote: "Stale closures — handlers capture the value at the time they were defined.", content: "Yes — stale closures. Show me the canonical fix." },
            { role: "assistant", model: "sonnet", credits: 2, content:
              "Use the **functional updater form**. It hands you the latest state value at call time.\n\n" +
              "```js\n// Stale: count is captured from this render\nsetTimeout(() => setCount(count + 1), 1000);\n\n// Fresh: prev is whatever count is when the timer fires\nsetTimeout(() => setCount(prev => prev + 1), 1000);\n```\n\n" +
              "Same rule applies inside event handlers, effects, and any async callback. If you're reading **multiple** state values, lift the logic into the updater or use a ref." },
          ],
        },
        n_us_ref: {
          id: "n_us_ref", parentId: "n_us_stale", depth: 2,
          label: "When to reach for useRef",
          messages: [
            { role: "user", quote: "use a ref", content: "When should I use useRef vs useState then?" },
            { role: "assistant", model: "haiku", credits: 1, content:
              "Use **state** when changing the value should re-render the component. Use a **ref** when it shouldn't.\n\n" +
              "Classic ref cases: holding a DOM node, a timer id, a `latest` mirror of state for use in stale closures, or a value that needs to survive renders but doesn't drive UI.\n\n" +
              "Reading `ref.current` is always fresh; assigning never re-renders." },
          ],
        },
      },
    },

    c_runclub: {
      id: "c_runclub",
      title: "Onboarding emails for run club app",
      created: "May 9",
      rootId: "n_run_root",
      currentNodeId: "n_run_root",
      nodes: {
        n_run_root: {
          id: "n_run_root", parentId: null, depth: 0,
          label: "Draft welcome email",
          messages: [
            { role: "user", content: "Write a welcome email for a new run club app called Stride. Friendly, not corporate." },
            { role: "assistant", model: "gpt4o", credits: 1, content:
              "**Subject:** You're in. Time to lace up.\n\n" +
              "Hey Maya,\n\n" +
              "Welcome to Stride. Here's the deal — we built this for the people who already run, not the people who *plan* to.\n\n" +
              "**Three things to try this week:**\n" +
              "• Pin one route from your neighborhood — Stride learns your pace.\n" +
              "• Invite one friend. Group runs unlock at 3.\n" +
              "• Log a run. Even a slow one. Especially a slow one.\n\n" +
              "See you out there.\n— The Stride team\n\nP.S. Reply to this email with feedback. We read every one." },
          ],
        },
      },
    },

    c_perf: {
      id: "c_perf",
      title: "Postgres slow query",
      created: "May 8",
      rootId: "n_pg_root",
      currentNodeId: "n_pg_root",
      nodes: {
        n_pg_root: {
          id: "n_pg_root", parentId: null, depth: 0,
          label: "EXPLAIN ANALYZE",
          messages: [
            { role: "user", content: "Why is my query slow? It's a simple select with one join, but takes 4 seconds on 200k rows." },
            { role: "assistant", model: "sonnet", credits: 2, content:
              "Without `EXPLAIN ANALYZE` I'm guessing — but on a 200k-row join, the usual suspect is a **missing index on the join column** forcing a sequential scan.\n\n" +
              "Run:\n```sql\nEXPLAIN (ANALYZE, BUFFERS) SELECT ...;\n```\n\n" +
              "Look for `Seq Scan` on a large table or `Hash Join` with high `Buffers`. Paste the plan and I'll point at the fix." },
          ],
        },
      },
    },
  },

  // Reflection drafts — golden-path doc per chat (initially empty / null)
  reflections: {},

  // Order in sidebar
  chatOrder: ["c_japan", "c_useState", "c_runclub", "c_perf"],
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
const newId = (prefix = "n") => prefix + "_" + Math.random().toString(36).slice(2, 8);

// Build path from node up to root (inclusive of both)
const pathToRoot = (chat, nodeId) => {
  const arr = [];
  let cur = nodeId;
  while (cur) {
    const n = chat.nodes[cur];
    if (!n) break;
    arr.unshift(n);
    cur = n.parentId;
  }
  return arr;
};

const childrenOf = (chat, nodeId) =>
  Object.values(chat.nodes).filter(n => n.parentId === nodeId);

// Pretty number with comma
const fmt = (n) => n.toLocaleString();

// Sum USD cost in a chat / path. Messages from real sends carry costUsd;
// seed-data messages carry the old `credits` field which we ignore here.
const costInPath = (chat, nodeId) => {
  let sum = 0;
  pathToRoot(chat, nodeId).forEach(n => {
    n.messages.forEach(m => { if (typeof m.costUsd === "number") sum += m.costUsd; });
  });
  return sum;
};
const costInChat = (chat) => {
  let sum = 0;
  Object.values(chat.nodes).forEach(n => {
    n.messages.forEach(m => { if (typeof m.costUsd === "number") sum += m.costUsd; });
  });
  return sum;
};
// Back-compat aliases used by some chat-card thumbnails.
const creditsInPath = costInPath;
const creditsInChat = costInChat;

// Render markdown-ish content into JSX. We support: paragraphs (\n\n),
// **bold**, *italic*, `code`, bullets ("• ", "- "), and ```code blocks```.
const renderBody = (content, opts = {}) => {
  if (!content) return null;
  const blocks = [];
  // Split on triple-backtick fences first
  const segments = content.split(/```([\s\S]*?)```/);
  segments.forEach((seg, i) => {
    if (i % 2 === 1) {
      // Code fence
      const firstLineBreak = seg.indexOf("\n");
      const lang = firstLineBreak >= 0 ? seg.slice(0, firstLineBreak).trim() : "";
      const code = firstLineBreak >= 0 ? seg.slice(firstLineBreak + 1) : seg;
      blocks.push({ type: "code", lang, body: code.replace(/\n$/, "") });
    } else {
      // Split text into paragraphs (double newline) or single line groups
      const paragraphs = seg.split(/\n{2,}/);
      paragraphs.forEach(p => {
        if (!p.trim()) return;
        // Bullet list?
        if (p.split("\n").every(l => /^\s*[•\-]\s+/.test(l) || !l.trim())) {
          const items = p.split("\n").filter(l => l.trim()).map(l => l.replace(/^\s*[•\-]\s+/, ""));
          blocks.push({ type: "ul", items });
        } else {
          blocks.push({ type: "p", body: p });
        }
      });
    }
  });
  return blocks.map((b, i) => {
    if (b.type === "code") return (
      <pre key={i}><code>{b.body}</code></pre>
    );
    if (b.type === "ul") return (
      <ul key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it, opts)}</li>)}</ul>
    );
    return <p key={i}>{renderInline(b.body, opts)}</p>;
  });
};
const renderInline = (text, opts = {}) => {
  // Tokenize: **bold**, *italic*, `code`
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, key = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("*")) out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("`")) out.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<span key={key++}>{text.slice(last)}</span>);
  // If opts.wrap is given, wrap each text node so it's selectable for branching.
  // We just return raw spans; selection works natively over the text.
  return out;
};

// ------------------------------------------------------------------
// Beta only — OpenRouter API key + user-added custom models.
// Both live in localStorage. The key is *never* sent anywhere except
// OpenRouter's API endpoint when chatting.
// ------------------------------------------------------------------
const API_KEY_KEY = "cogninode_openrouter_key";
const CUSTOM_MODELS_KEY = "cogninode_custom_models";

const getApiKey = () => {
  try { return localStorage.getItem(API_KEY_KEY) || ""; } catch (e) { return ""; }
};
const setApiKey = (k) => {
  try {
    if (k) localStorage.setItem(API_KEY_KEY, k);
    else   localStorage.removeItem(API_KEY_KEY);
  } catch (e) {}
};
const maskApiKey = (k) => {
  if (!k) return "";
  const prefix = k.length > 8 ? k.slice(0, 7) : k.slice(0, Math.min(4, k.length));
  return prefix + "…" + "•".repeat(20);
};

const loadCustomModels = () => {
  try { return JSON.parse(localStorage.getItem(CUSTOM_MODELS_KEY)) || []; }
  catch (e) { return []; }
};
const saveCustomModels = (arr) => {
  try { localStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(arr)); }
  catch (e) {}
};

// Local storage helpers
const STORE_KEY = "cogninode_v1";
const loadStore = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
};
const saveStore = (data) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {}
};
const initStore = () => {
  const existing = loadStore();
  if (existing && existing.chats) return existing;
  const fresh = JSON.parse(JSON.stringify(SEED));
  saveStore(fresh);
  return fresh;
};
const clearStore = () => { try { localStorage.removeItem(STORE_KEY); } catch (e) {} };

// ------------------------------------------------------------------
// Sidebar (reused across chat/settings/billing/chats pages)
// ------------------------------------------------------------------
const SIDEBAR_EXPANDED_KEY = "cogninode_sidebar_expanded_v1";
const loadSidebarExpanded = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SIDEBAR_EXPANDED_KEY)) || []); } catch (e) { return new Set(); }
};
const saveSidebarExpanded = (s) => {
  try { localStorage.setItem(SIDEBAR_EXPANDED_KEY, JSON.stringify([...s])); } catch (e) {}
};

const Sidebar = ({ store, activeChatId, activeNodeId, onNavigate, onNewChat, onSelectChat, onSelectNode, onOpenSettings }) => {
  const [search, setSearch] = React.useState("");
  const [expandedChats, setExpandedChats] = React.useState(() => new Set(activeChatId ? [activeChatId] : []));
  // Per-node collapse state, keyed by `${chatId}:${nodeId}`. Persisted.
  const [expandedNodes, setExpandedNodes] = React.useState(() => loadSidebarExpanded());
  // Live-watch the API key so the footer dot/mask updates after a
  // settings modal save (which only mutates localStorage in the same tab).
  const [apiKey, setApiKeyLocal] = React.useState(() => getApiKey());
  React.useEffect(() => {
    const onStorage = (e) => {
      if (!e || e.key === API_KEY_KEY) setApiKeyLocal(getApiKey());
    };
    const onCustom = () => setApiKeyLocal(getApiKey());
    window.addEventListener("storage", onStorage);
    window.addEventListener("cogninode:apikey-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("cogninode:apikey-changed", onCustom);
    };
  }, []);

  React.useEffect(() => {
    if (activeChatId) setExpandedChats(prev => new Set([...prev, activeChatId]));
  }, [activeChatId]);

  // Auto-expand ancestors of the active node so it's always visible.
  React.useEffect(() => {
    if (!activeChatId || !activeNodeId) return;
    const chat = store.chats[activeChatId];
    if (!chat) return;
    const path = pathToRoot(chat, activeNodeId);
    setExpandedNodes(prev => {
      const next = new Set(prev);
      let changed = false;
      path.forEach(n => {
        const k = `${activeChatId}:${n.id}`;
        if (!next.has(k)) { next.add(k); changed = true; }
      });
      if (!changed) return prev;
      saveSidebarExpanded(next);
      return next;
    });
  }, [activeChatId, activeNodeId, store]);

  const toggleChatExpand = (id, e) => {
    e?.stopPropagation();
    setExpandedChats(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleNodeExpand = (cid, nid, e) => {
    e?.stopPropagation();
    setExpandedNodes(prev => {
      const next = new Set(prev);
      const key = `${cid}:${nid}`;
      if (next.has(key)) next.delete(key); else next.add(key);
      saveSidebarExpanded(next);
      return next;
    });
  };

  // DFS-walk the chat tree, producing one row per visible node, with
  // `lastFlags` describing which ancestor columns are "last child" (for
  // drawing connector guides: trunk / tee / elbow / blank).
  const buildRows = (chat) => {
    const childrenMap = {};
    Object.values(chat.nodes).forEach(n => {
      if (n.parentId) (childrenMap[n.parentId] ||= []).push(n);
    });
    // Stable sort children by id so the tree stays put across renders.
    Object.values(childrenMap).forEach(arr =>
      arr.sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0))
    );

    const rows = [];
    const walk = (id, lastFlags) => {
      const n = chat.nodes[id];
      if (!n) return;
      const kids = childrenMap[id] || [];
      const isRoot = n.parentId === null;
      const expanded = isRoot || expandedNodes.has(`${chat.id}:${id}`);
      rows.push({
        node: n,
        lastFlags,
        hasChildren: kids.length > 0,
        childCount: kids.length,
        expanded,
      });
      if (expanded && kids.length) {
        kids.forEach((k, i) => walk(k.id, [...lastFlags, i === kids.length - 1]));
      }
    };
    walk(chat.rootId, []);
    return rows;
  };

  const filtered = store.chatOrder.filter(id => {
    if (!search) return true;
    const c = store.chats[id];
    const hay = (c.title + " " + Object.values(c.nodes).map(n => n.label).join(" ")).toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  return (
    <aside className="side">
      <div className="side-top">
        <a href="chats.html" className="side-brand">
          <Glyph size={22}/>
          <span>cogninode <span className="beta-tag">beta</span></span>
        </a>
        <a href="chats.html" className="icon-btn" title="All chats">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
            <rect x="9" y="3" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
            <rect x="2" y="10" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.4"/>
            <rect x="9" y="10" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
        </a>
      </div>

      <div className="side-search">
        <svg className="s-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M10.5 10.5 L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          placeholder="Search chats…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="s-kbd">⌃K</span>
      </div>

      <button className="side-new" onClick={onNewChat}>
        <span className="plus">+</span>
        New chat
        <span className="kbd">⌃N</span>
      </button>

      <div className="side-section-h">Recent chats</div>

      <div className="side-list">
        {filtered.map(id => {
          const c = store.chats[id];
          const isActive = activeChatId === id;
          const isExpanded = expandedChats.has(id);
          const rows = isExpanded ? buildRows(c) : [];
          return (
            <React.Fragment key={id}>
              <div
                className={`chat-row ${isActive ? "active" : ""} ${isExpanded ? "expanded" : ""}`}
                onClick={() => onSelectChat?.(id)}
              >
                <button className="chevron" onClick={(e) => toggleChatExpand(id, e)} title={isExpanded ? "Collapse" : "Expand"}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M3 2 L7 5 L3 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <span className="c-label">{c.title}</span>
                <span className="c-count">{Object.keys(c.nodes).length}</span>
              </div>
              {isExpanded && (
                <div className="branch-list">
                  {rows.map(r => {
                    const n = r.node;
                    const rowActive = activeChatId === id && activeNodeId === n.id;
                    return (
                      <div
                        key={n.id}
                        className={`branch-row ${rowActive ? "active" : ""}`}
                        data-depth={Math.min(3, n.depth)}
                        onClick={() => onSelectNode?.(id, n.id)}
                      >
                        {r.lastFlags.length > 0 && (
                          <div className="b-guides">
                            {r.lastFlags.map((isLast, i) => {
                              const isElbow = i === r.lastFlags.length - 1;
                              const cls = isElbow
                                ? (isLast ? "elbow" : "tee")
                                : (isLast ? "blank" : "trunk");
                              return <span key={i} className={`bg ${cls}`}></span>;
                            })}
                          </div>
                        )}
                        {r.hasChildren ? (
                          <button
                            className={`b-chev ${r.expanded ? "open" : ""}`}
                            onClick={(e) => toggleNodeExpand(id, n.id, e)}
                            title={r.expanded ? "Collapse" : "Expand"}
                          >
                            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                              <path d="M3 2 L7 5 L3 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        ) : (
                          <span className="b-chev-spacer"></span>
                        )}
                        <span className="b-dot"></span>
                        <span className="b-label">{n.label}</span>
                        {r.hasChildren && <span className="b-count">{r.childCount}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: "20px 12px", color: "var(--ink-3)", fontSize: 13, textAlign: "center" }}>
            No chats match "{search}"
          </div>
        )}
      </div>

      <div className="side-foot">
        <div className="avatar key-avatar" title="cogninode beta">
          <Glyph size={20} color="var(--ink)" accent="var(--coral)"/>
        </div>
        <div className="who">
          <span className="name">OpenRouter</span>
          <span className="credits key-line">
            <span className={`cred-dot ${apiKey ? "ok" : "bad"}`}></span>
            <span className="key-mono">{apiKey ? maskApiKey(apiKey) : "No API key set"}</span>
          </span>
        </div>
        <button className="icon-btn" onClick={() => onOpenSettings?.()} title="Settings (⌃,)">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M2.5 4 H13.5 M2.5 8 H13.5 M2.5 12 H13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <circle cx="10"  cy="4"  r="1.8" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="5.5" cy="8"  r="1.8" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="11"  cy="12" r="1.8" fill="var(--bg)" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
        </button>
        <ThemeToggle inSidebar/>
      </div>
    </aside>
  );
};

// ------------------------------------------------------------------
// Toast
// ------------------------------------------------------------------
const Toast = ({ children, onDone, duration = 2200 }) => {
  React.useEffect(() => {
    if (!onDone) return;
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [onDone, duration]);
  return <div className="toast"><span className="toast-dot"></span>{children}</div>;
};

// ------------------------------------------------------------------
// Mini-tree (for chat card thumbnails)
// ------------------------------------------------------------------
const MiniTreeThumb = ({ chat }) => {
  const nodes = Object.values(chat.nodes);
  // Layout: root in center top, children fan out
  const positions = {};
  const childrenMap = {};
  nodes.forEach(n => {
    if (n.parentId) (childrenMap[n.parentId] ||= []).push(n.id);
  });
  let leafX = 0;
  const computeX = (id) => {
    const kids = childrenMap[id] || [];
    if (!kids.length) { positions[id] = { x: leafX++, y: chat.nodes[id].depth }; return positions[id].x; }
    const xs = kids.map(computeX);
    const x = (xs[0] + xs[xs.length-1]) / 2;
    positions[id] = { x, y: chat.nodes[id].depth };
    return x;
  };
  computeX(chat.rootId);
  const maxX = Math.max(1, leafX - 1);
  const maxY = Math.max(1, Math.max(...nodes.map(n => n.depth)));
  const pos = (id) => {
    const p = positions[id];
    return {
      x: maxX === 0 ? 50 : 10 + (p.x / maxX) * 80,
      y: maxY === 0 ? 50 : 10 + (p.y / maxY) * 80,
    };
  };
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none" style={{ overflow: "visible" }}>
      {nodes.map(n => {
        if (!n.parentId) return null;
        const a = pos(n.parentId), b = pos(n.id);
        return <line key={n.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke="var(--line)" strokeWidth="0.8" strokeLinecap="round"/>;
      })}
      {nodes.map(n => {
        const p = pos(n.id);
        const fill = n.depth === 0 ? "var(--coral)" : n.depth === 1 ? "var(--teal)" : n.depth === 2 ? "var(--lilac)" : "var(--butter)";
        return <circle key={n.id} cx={p.x} cy={p.y} r="2.2" fill={fill}
          stroke="white" strokeWidth="0.6"/>;
      })}
    </svg>
  );
};

// ------------------------------------------------------------------
// Theme toggle (sun/moon). Default theme = dark; persisted to
// localStorage under 'cogninode_theme'. The pre-paint bootstrap that
// reads this key lives in each page's <head> to avoid flash-of-light.
// ------------------------------------------------------------------
const ThemeToggle = ({ inSidebar = false }) => {
  const [dark, setDark] = React.useState(() =>
    document.documentElement.getAttribute("data-theme") === "dark"
  );
  const flip = () => {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("cogninode_theme", next ? "dark" : "light"); } catch (e) {}
  };
  return (
    <button
      className={inSidebar ? "icon-btn theme-toggle-inline" : "theme-toggle"}
      onClick={flip}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? (
        // Sun — currently dark, click for light
        <svg viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="3" fill="currentColor"/>
          <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M8 1.5 V3"/><path d="M8 13 V14.5"/>
            <path d="M1.5 8 H3"/><path d="M13 8 H14.5"/>
            <path d="M3.2 3.2 L4.3 4.3"/><path d="M11.7 11.7 L12.8 12.8"/>
            <path d="M3.2 12.8 L4.3 11.7"/><path d="M11.7 4.3 L12.8 3.2"/>
          </g>
        </svg>
      ) : (
        // Moon — currently light, click for dark
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M13.5 9.5 A6 6 0 1 1 6.5 2.5 A4.5 4.5 0 0 0 13.5 9.5 Z"
                fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
};

// Make all available globally for other Babel script files
Object.assign(window, {
  Glyph, BigTree, MODELS, getModel, ModelDot, ME, PLANS, TOPUPS,
  roughTokens, calculateCostUsd, estimateCostUsd, formatCost, formatEstimate,
  // Back-compat aliases for files not yet updated.
  calculateCredits: calculateCostUsd, estimateCredits: estimateCostUsd,
  SEED, newId, pathToRoot, childrenOf, fmt,
  costInPath, costInChat, creditsInPath, creditsInChat,
  renderBody, renderInline, loadStore, saveStore, initStore, clearStore,
  Sidebar, Toast, MiniTreeThumb, ThemeToggle,
  // Beta only
  getApiKey, setApiKey, maskApiKey, API_KEY_KEY,
  loadCustomModels, saveCustomModels, CUSTOM_MODELS_KEY,
});
