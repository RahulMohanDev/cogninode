// Shared markdown renderer used by completed messages AND the live streaming
// tail. Built on streamdown, which is a drop-in for react-markdown that
// gracefully handles partial syntax during a stream (unclosed code fences,
// unclosed bold/italic, etc) so the rendering doesn't "snap" when the stream
// completes.
//
// Anchors are forced to open in a new tab with a hardened rel. Raw HTML in
// markdown is stripped — we don't enable rehype-raw — so untrusted assistant
// output can't inject script tags.
//
// ─── Code blocks ─────────────────────────────────────────────────
//
// Fenced code blocks use streamdown's built-in <CodeBlock> family. Streamdown
// emits a stable markup tree of `data-streamdown="code-block" / -header /
// -actions / -copy-button / -body` elements that we style via app.css into a
// GitHub-style card (header bar on top, language label left, copy button
// right, highlighted body below).
//
// Streamdown 2.5.0 does NOT bundle a syntax highlighter. The `shikiTheme`
// prop only configures themes in context — without a `plugins.code`
// implementation, lines are emitted as `<span><span>…line text…</span></span>`
// with `color:inherit` (no per-token colours) AND **no newline character
// between line spans**. In a `<pre>` block this collapses every line onto
// one visual row.
//
// We solve both halves:
//
//   1. CSS in `app.css` forces direct `<span>` children of `<code>` inside
//      a streamdown code body to `display: block`, so lines render on their
//      own row regardless of highlighter state.
//
//   2. The `plugins.code` CodeHighlighterPlugin below uses highlight.js
//      (already a dependency for the Tiptap editor) to tokenise. Each token
//      carries an inline `color` (light palette) and an `htmlStyle` setting
//      `--shiki-dark` (dark palette), so the dual-theme CSS at
//      `[data-streamdown="code-block-body"] pre code span` picks the right
//      colour for html[data-theme]. Grammars are loaded on demand via
//      dynamic `import()` so they code-split into their own chunks instead
//      of bloating the eager bundle.

import {
  Streamdown,
  type Components,
  type ControlsConfig,
  type CodeHighlighterPlugin,
  type HighlightOptions,
  type PluginConfig,
  type ThemeInput,
} from "streamdown";

// `HighlightResult` and `HighlightToken` are declared inside streamdown's
// .d.ts but not re-exported. We mirror them locally — these shapes haven't
// changed since the plugin API landed in streamdown 2.x and are stable
// across minors.
interface HighlightToken {
  bgColor?:   string;
  color?:     string;
  content:    string;
  htmlAttrs?: Record<string, string>;
  htmlStyle?: Record<string, string>;
  offset?:    number;
}
interface HighlightResult {
  bg?:        string;
  fg?:        string;
  rootStyle?: string | false;
  tokens:     HighlightToken[][];
}

// ── Components / controls ─────────────────────────────────────────

const components: Components = {
  a: ({ node: _node, href, children, ...rest }) => (
    <a
      {...rest}
      href={href ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};

// Suppress streamdown's table/mermaid action overlays and the code-block
// download button — we only want the copy button on code blocks.
const controls: ControlsConfig = {
  code:    { copy: true, download: false },
  table:   false,
  mermaid: false,
};

// Streamdown stores `shikiTheme` on context; our plugin doesn't actually
// use these (we have our own palette baked into the token stream), but the
// type contract requires a tuple, so we provide canonical names.
const shikiTheme: [ThemeInput, ThemeInput] = ["github-light", "github-dark"];

// ── Highlight.js–backed CodeHighlighterPlugin ─────────────────────
//
// Streamdown's `HighlightedCodeBlockBody` calls `plugin.highlight({code,
// language, themes}, callback)`. If `language` isn't ready yet, we kick off
// a dynamic import and return `null`; the callback fires once tokens are
// available, which re-renders the code body with colours. Once a grammar
// is registered on our hljs instance, subsequent calls are synchronous.

type HLJS = {
  highlight: (code: string, opts: { language: string; ignoreIllegals?: boolean }) => { value: string };
  registerLanguage: (name: string, fn: unknown) => void;
  registerAliases: (aliases: string | string[], opts: { languageName: string }) => void;
  getLanguage: (name: string) => unknown;
  listLanguages: () => string[];
};

// Canonical language → dynamic loader. Each entry produces its own chunk.
const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  bash:       () => import("highlight.js/lib/languages/bash"),
  c:          () => import("highlight.js/lib/languages/c"),
  cpp:        () => import("highlight.js/lib/languages/cpp"),
  csharp:     () => import("highlight.js/lib/languages/csharp"),
  css:        () => import("highlight.js/lib/languages/css"),
  go:         () => import("highlight.js/lib/languages/go"),
  java:       () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json:       () => import("highlight.js/lib/languages/json"),
  kotlin:     () => import("highlight.js/lib/languages/kotlin"),
  markdown:   () => import("highlight.js/lib/languages/markdown"),
  php:        () => import("highlight.js/lib/languages/php"),
  python:     () => import("highlight.js/lib/languages/python"),
  ruby:       () => import("highlight.js/lib/languages/ruby"),
  rust:       () => import("highlight.js/lib/languages/rust"),
  scala:      () => import("highlight.js/lib/languages/scala"),
  shell:      () => import("highlight.js/lib/languages/shell"),
  sql:        () => import("highlight.js/lib/languages/sql"),
  swift:      () => import("highlight.js/lib/languages/swift"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml:        () => import("highlight.js/lib/languages/xml"),
  yaml:       () => import("highlight.js/lib/languages/yaml"),
};

// Common aliases users type in fenced code blocks → canonical hljs grammar.
const ALIASES: Record<string, string> = {
  ts:         "typescript",
  tsx:        "typescript",
  js:         "javascript",
  jsx:        "javascript",
  sh:         "bash",
  zsh:        "bash",
  html:       "xml",
  htm:        "xml",
  svg:        "xml",
  yml:        "yaml",
  md:         "markdown",
  py:         "python",
  rb:         "ruby",
  rs:         "rust",
  kt:         "kotlin",
  "c++":      "cpp",
  "c#":       "csharp",
  cs:         "csharp",
  golang:     "go",
  objective_c: "c",
  obj_c:      "c",
};

function canonicalLanguage(raw: string): string | null {
  const k = raw.toLowerCase().trim();
  if (!k) return null;
  if (LOADERS[k])  return k;
  const aliased = ALIASES[k];
  if (aliased && LOADERS[aliased]) return aliased;
  return null;
}

// github-light / github-dark token palette. Keys are hljs scope classes
// (without the `hljs-` prefix). Each entry is `[light, dark]`. Anything
// unrecognised falls through to `inherit`.
const PALETTE: Record<string, readonly [string, string]> = {
  // keywords / types
  keyword:             ["#d73a49", "#ff7b72"],
  "keyword.literal":   ["#005cc5", "#79c0ff"],
  doctag:              ["#d73a49", "#ff7b72"],
  type:                ["#d73a49", "#ff7b72"],
  "template-tag":      ["#d73a49", "#ff7b72"],
  "template-variable": ["#d73a49", "#ff7b72"],
  // identifiers
  title:               ["#6f42c1", "#d2a8ff"],
  "title.function_":   ["#6f42c1", "#d2a8ff"],
  "title.class_":      ["#6f42c1", "#d2a8ff"],
  built_in:            ["#e36209", "#ffa657"],
  symbol:              ["#e36209", "#ffa657"],
  // literals
  number:              ["#005cc5", "#79c0ff"],
  literal:             ["#005cc5", "#79c0ff"],
  variable:            ["#005cc5", "#79c0ff"],
  "variable.language_":["#d73a49", "#ff7b72"],
  attr:                ["#005cc5", "#79c0ff"],
  attribute:           ["#005cc5", "#79c0ff"],
  meta:                ["#005cc5", "#79c0ff"],
  operator:            ["#005cc5", "#79c0ff"],
  "selector-attr":     ["#005cc5", "#79c0ff"],
  "selector-class":    ["#005cc5", "#79c0ff"],
  "selector-id":       ["#005cc5", "#79c0ff"],
  // strings
  string:              ["#032f62", "#a5d6ff"],
  regexp:              ["#032f62", "#a5d6ff"],
  // comments
  comment:             ["#6a737d", "#8b949e"],
  code:                ["#6a737d", "#8b949e"],
  formula:             ["#6a737d", "#8b949e"],
  // tags / sections
  name:                ["#22863a", "#7ee787"],
  quote:               ["#22863a", "#7ee787"],
  "selector-tag":      ["#22863a", "#7ee787"],
  "selector-pseudo":   ["#22863a", "#7ee787"],
  section:             ["#005cc5", "#79c0ff"],
  bullet:              ["#735c0f", "#f2cc60"],
  // diff
  addition:            ["#22863a", "#aff5b4"],
  deletion:            ["#b31d28", "#ffdcd7"],
};

function colorFor(scope: string): readonly [string, string] | null {
  // hljs class lists look like ["hljs-title", "function_"] (sub-scopes are
  // additional class names without the `hljs-` prefix). We check the most
  // specific compound first, then fall back to the leading scope.
  const compound = scope;
  const leading  = scope.split(".")[0] ?? scope;
  return PALETTE[compound] ?? (leading ? PALETTE[leading] ?? null : null);
}

// hljs emits HTML with nested `<span class="hljs-keyword">…</span>` tokens.
// We parse this with a tiny stateful scanner — no `innerHTML`, no DOM — and
// flatten to `{content, color, htmlStyle:{--shiki-dark}}` tokens grouped by
// line. We deliberately do NOT use `DOMParser` so this works during SSR /
// React renderToString and incurs no DOM allocation per code block.

const HTML_ENTITIES: Record<string, string> = {
  "&amp;":  "&",
  "&lt;":   "<",
  "&gt;":   ">",
  "&quot;": '"',
  "&#39;":  "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m);
}

interface ScopeFrame {
  /** Concatenated scope path, e.g. "title.function_". */
  scope: string;
}

function htmlToTokens(html: string): HighlightToken[][] {
  // Walk the html string, maintaining a stack of open hljs scopes. Emit a
  // token whenever we cross a `\n`, an open/close tag, or end-of-input.
  const lines: HighlightToken[][] = [[]];
  let current = lines[0]!;
  const stack: ScopeFrame[] = [];

  const pushText = (text: string): void => {
    if (!text) return;
    const decoded = decodeEntities(text);
    const top = stack.at(-1);
    const pair = top ? colorFor(top.scope) : null;
    const parts = decoded.split("\n");
    for (let i = 0; i < parts.length; i += 1) {
      const piece = parts[i] ?? "";
      if (piece.length > 0) {
        const tok: HighlightToken = { content: piece };
        if (pair) {
          const [light, dark] = pair;
          tok.color    = light;
          tok.htmlStyle = { "--shiki-dark": dark };
        }
        current.push(tok);
      }
      if (i < parts.length - 1) {
        const next: HighlightToken[] = [];
        lines.push(next);
        current = next;
      }
    }
  };

  // Minimal tag scanner — hljs only emits `<span class="hljs-...">` and
  // `</span>`, so we don't need a real HTML parser.
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      pushText(html.slice(i));
      break;
    }
    if (lt > i) pushText(html.slice(i, lt));
    const gt = html.indexOf(">", lt);
    if (gt < 0) {
      // malformed tail, treat rest as text
      pushText(html.slice(lt));
      break;
    }
    const tag = html.slice(lt + 1, gt);
    if (tag.startsWith("/")) {
      stack.pop();
    } else {
      // Extract `hljs-foo` and any `bar baz` extra sub-scope classes.
      const cm = tag.match(/class="([^"]*)"/);
      const classes = cm?.[1]?.split(/\s+/) ?? [];
      let head: string | undefined;
      const extras: string[] = [];
      for (const cls of classes) {
        if (cls.startsWith("hljs-")) head = cls.slice(5);
        else if (cls) extras.push(cls);
      }
      const scope = head
        ? (extras.length ? `${head}.${extras.join(".")}` : head)
        : "";
      stack.push({ scope });
    }
    i = gt + 1;
  }

  return lines;
}

// ── Plugin instance ───────────────────────────────────────────────

interface HighlighterState {
  hljs: HLJS | null;
  /** Languages successfully registered on the hljs instance. */
  ready: Set<string>;
  /** In-flight loads, so concurrent calls share one promise per language. */
  loading: Map<string, Promise<void>>;
}

const state: HighlighterState = {
  hljs:      null,
  ready:     new Set<string>(),
  loading:   new Map<string, Promise<void>>(),
};

async function loadHljsCore(): Promise<HLJS> {
  if (state.hljs) return state.hljs;
  const mod = await import("highlight.js/lib/core");
  // hljs ESM default is the singleton API.
  state.hljs = mod.default as unknown as HLJS;
  return state.hljs;
}

function ensureLanguage(canonical: string): Promise<void> {
  if (state.ready.has(canonical)) return Promise.resolve();
  const existing = state.loading.get(canonical);
  if (existing) return existing;
  const loader = LOADERS[canonical];
  if (!loader) return Promise.resolve();
  const p = (async () => {
    const [hljs, grammarMod] = await Promise.all([loadHljsCore(), loader()]);
    if (!hljs.getLanguage(canonical)) {
      hljs.registerLanguage(canonical, grammarMod.default);
    }
    if (canonical === "shell" && !hljs.getLanguage("bash")) {
      const bashMod = await LOADERS.bash!();
      hljs.registerLanguage("bash", bashMod.default);
      state.ready.add("bash");
    }
    state.ready.add(canonical);
  })().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`[MarkdownBody] failed to load grammar "${canonical}":`, err);
  }).finally(() => {
    state.loading.delete(canonical);
  });
  state.loading.set(canonical, p);
  return p;
}

// Tokenised-result cache keyed by `${language} ${code}`. Lets us return
// synchronously on the second `highlight` call once the language has loaded.
const tokenCache = new Map<string, HighlightResult>();

function tokenize(canonical: string, code: string): HighlightResult | null {
  const hljs = state.hljs;
  if (!hljs || !state.ready.has(canonical)) return null;
  const key = `${canonical} ${code}`;
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const { value } = hljs.highlight(code, { language: canonical, ignoreIllegals: true });
  const result: HighlightResult = {
    bg:     "transparent",
    fg:     "inherit",
    tokens: htmlToTokens(value),
  };
  tokenCache.set(key, result);
  // Cap cache to last ~200 distinct results; oldest evicted via Map iteration.
  if (tokenCache.size > 200) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey !== undefined) tokenCache.delete(firstKey);
  }
  return result;
}

const codePlugin: CodeHighlighterPlugin = {
  name:                  "shiki",
  type:                  "code-highlighter",
  getSupportedLanguages: () => Object.keys(LOADERS) as never[],
  getThemes:             () => shikiTheme,
  supportsLanguage:      (language: string) => canonicalLanguage(language) !== null,
  highlight: (options: HighlightOptions, callback?: (result: HighlightResult) => void) => {
    const canonical = canonicalLanguage(options.language);
    if (!canonical) return null;
    const cached = tokenize(canonical, options.code);
    if (cached) return cached;
    void ensureLanguage(canonical).then(() => {
      if (!callback) return;
      const out = tokenize(canonical, options.code);
      if (out) callback(out);
    });
    return null;
  },
};

const plugins: PluginConfig = { code: codePlugin };

// ── Component ─────────────────────────────────────────────────────

export function MarkdownBody({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="md">
      <Streamdown
        components={components}
        controls={controls}
        shikiTheme={shikiTheme}
        plugins={plugins}
        lineNumbers={false}
      >
        {text}
      </Streamdown>
    </div>
  );
}

export default MarkdownBody;
