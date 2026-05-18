# cogninode — Beta Technical Documentation
**Open source · Local-only · No backend · No auth · User-supplied OpenRouter key**

This document covers the beta release of cogninode: a fully client-side React app where all data lives in the browser and AI calls go directly from the user's browser to OpenRouter using their own API key. No server, no account, no payments.

This is architecturally distinct from the production spec. Read this document independently.

---

## 1. What this is

```
Production:  React → Convex → OpenRouter
Beta:        React → IndexedDB (local) + OpenRouter (direct)
```

Everything runs in the browser. The user clones the repo, runs `npm run dev`, enters their OpenRouter key once, and the full cogninode feature set works immediately. All chat data is stored in their browser's IndexedDB. Nothing leaves the machine except API calls to OpenRouter.

**What works:**
- Full tree-shaped chat (branching, path-only context, sidebar tree)
- Reflections mode and saved notes
- Tree map overlay, quick jump, keyboard shortcuts
- File attachments (images, PDFs, code files — processed client-side)
- JSON export and import for backup
- Custom OpenRouter model support
- Real-time dollar cost display per message

**What's deliberately absent:**
- Auth of any kind
- Backend server
- Credits system (users pay OpenRouter directly)
- Rate limiting (OpenRouter handles this)
- Cloud sync

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser tab                                                │
│                                                             │
│  React + Vite SPA                                           │
│       │                                                     │
│       ├── Dexie.js (IndexedDB)                              │
│       │   chats · nodes · messages · reflections · files   │
│       │                                                     │
│       ├── localStorage                                      │
│       │   API key · preferences · drafts                   │
│       │                                                     │
│       └── fetch ──────────────────────────────────────────→│
│                            OpenRouter API                   │
│                            (streaming, user's own key)      │
└─────────────────────────────────────────────────────────────┘
```

**Read path:** `useLiveQuery(Dexie)` → UI. Always reactive, always instant.

**Write path:** write to Dexie → UI updates via `useLiveQuery` → no sync needed.

**AI path:** build path prompt from Dexie → `fetch` to OpenRouter with `stream: true` → pipe SSE chunks to UI → persist completed message to Dexie.

OpenRouter explicitly supports browser-side API calls with user-supplied keys and sets appropriate CORS headers. No proxy is needed.

---

## 3. Project structure

```
cogninode-beta/
├── src/
│   ├── main.tsx                    # Entry, providers (just router + Dexie)
│   ├── App.tsx                     # Router + ApiKeyGate wrapper
│   │
│   ├── lib/
│   │   ├── db.ts                   # Dexie schema + typed helpers
│   │   ├── stream.ts               # OpenRouter SSE consumer
│   │   ├── path.ts                 # DFS path builder from Dexie
│   │   ├── cost.ts                 # USD cost calculator + model list
│   │   ├── files.ts                # File reading: base64, PDF text, code
│   │   └── export.ts               # JSON export and import
│   │
│   ├── hooks/
│   │   ├── useSettings.ts          # API key + preferences (localStorage)
│   │   ├── usePathMessages.ts      # useLiveQuery path for cost estimate
│   │   ├── useCostEstimate.ts      # Live pre-send cost display
│   │   └── useStream.ts            # Streaming state machine
│   │
│   ├── components/
│   │   ├── setup/
│   │   │   └── ApiKeyGate.tsx      # First-run key entry screen
│   │   ├── chat/
│   │   │   ├── ChatApp.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Stream.tsx
│   │   │   ├── Composer.tsx
│   │   │   ├── Message.tsx
│   │   │   ├── Overlays.tsx        # QuickJump, TreeMap, Shortcuts
│   │   │   └── SelectionPopup.tsx
│   │   └── settings/
│   │       └── SettingsModal.tsx   # API key, model defaults, export/import
│   │
│   └── pages/
│       ├── Chats.tsx
│       └── Chat.tsx
│
├── public/
│   └── _redirects                  # /* /index.html 200 (if deployed)
│
├── .env.example                    # Empty — no env vars needed
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── LICENSE                         # MIT
└── README.md
```

---

## 4. Storage strategy

### 4.1 IndexedDB via Dexie — all chat data

```typescript
// src/lib/db.ts
import Dexie, { type EntityTable } from "dexie";

// ── Local types ────────────────────────────────────────────────

export interface Chat {
  _id:           string;   // crypto.randomUUID()
  title:         string;
  rootNodeId:    string;
  currentNodeId: string;
  createdAt:     number;
  updatedAt:     number;
}

export interface Node {
  _id:       string;
  chatId:    string;
  parentId:  string | null;
  depth:     number;
  label:     string;         // first 60 chars of quote or first message
  createdAt: number;
}

export interface Message {
  _id:          string;
  nodeId:       string;
  chatId:       string;
  role:         "user" | "assistant";
  content:      string;
  modelId?:     string;
  costUsd?:     number;        // actual API cost — stored post-send
  inputTokens?: number;
  outputTokens?: number;
  pathDepth?:   number;        // path length at send time
  quote?:       string;        // text that triggered this branch
  fileIds?:     string[];      // references to files table
  createdAt:    number;
}

export interface Reflection {
  _id:       string;
  chatId:    string;
  nodeId:    string;
  title:     string;
  body:      string;           // distilled markdown
  updatedAt: number;
}

export interface StoredFile {
  _id:       string;
  name:      string;
  kind:      "image" | "pdf" | "code" | "file";
  mimeType:  string;
  sizeBytes: number;
  content:   string;           // base64 data URL for images; plain text for others
  createdAt: number;
}

// ── Dexie database ─────────────────────────────────────────────

export const db = new Dexie("cogninode") as Dexie & {
  chats:       EntityTable<Chat,        "_id">;
  nodes:       EntityTable<Node,        "_id">;
  messages:    EntityTable<Message,     "_id">;
  reflections: EntityTable<Reflection,  "_id">;
  files:       EntityTable<StoredFile,  "_id">;
};

db.version(1).stores({
  chats:       "_id, updatedAt",
  nodes:       "_id, chatId, parentId",
  messages:    "_id, nodeId, chatId, createdAt",
  reflections: "_id, nodeId, chatId",
  files:       "_id, createdAt",
});

// ── Typed helpers ──────────────────────────────────────────────

export function newId(): string {
  return crypto.randomUUID();
}

// Create a new chat with its root node in one transaction
export async function createChat(title = "New chat"): Promise<string> {
  const chatId = newId();
  const rootId = newId();

  await db.transaction("rw", db.chats, db.nodes, async () => {
    await db.nodes.add({
      _id:       rootId,
      chatId,
      parentId:  null,
      depth:     0,
      label:     title,
      createdAt: Date.now(),
    });
    await db.chats.add({
      _id:           chatId,
      title,
      rootNodeId:    rootId,
      currentNodeId: rootId,
      createdAt:     Date.now(),
      updatedAt:     Date.now(),
    });
  });

  return chatId;
}

// Create a branch node from a parent
export async function createBranch(params: {
  chatId:   string;
  parentId: string;
  depth:    number;
  label:    string;
}): Promise<string> {
  const nodeId = newId();

  await db.transaction("rw", db.nodes, db.chats, async () => {
    await db.nodes.add({
      _id:       nodeId,
      chatId:    params.chatId,
      parentId:  params.parentId,
      depth:     params.depth,
      label:     params.label,
      createdAt: Date.now(),
    });
    await db.chats.update(params.chatId, {
      currentNodeId: nodeId,
      updatedAt:     Date.now(),
    });
  });

  return nodeId;
}

// Walk DFS path from a node to root, return flat message array for prompt
export async function buildPathMessages(
  chatId: string,
  nodeId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string | unknown[] }>> {
  const allNodes = await db.nodes.where("chatId").equals(chatId).toArray();
  const nodeMap  = new Map(allNodes.map(n => [n._id, n]));

  // Walk to root
  const path: Node[] = [];
  let currentId: string | null = nodeId;
  while (currentId) {
    const node = nodeMap.get(currentId);
    if (!node) break;
    path.unshift(node);
    currentId = node.parentId;
  }

  // Collect messages in path order
  const result: Array<{ role: "user" | "assistant"; content: string | unknown[] }> = [];

  for (const node of path) {
    const msgs = await db.messages
      .where("nodeId").equals(node._id)
      .sortBy("createdAt");

    for (const msg of msgs) {
      // Build content — handle image attachments for multimodal
      if (msg.role === "user" && msg.fileIds?.length) {
        const files = await db.files
          .where("_id").anyOf(msg.fileIds)
          .toArray();

        const parts: unknown[] = [{ type: "text", text: msg.content }];
        for (const file of files) {
          if (file.kind === "image") {
            parts.push({ type: "image_url", image_url: { url: file.content } });
          }
          // PDF and code content was already appended to msg.content during compose
        }
        result.push({ role: "user", content: parts });
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }
  }

  return result;
}
```

### 4.2 localStorage — small config items

```typescript
// src/hooks/useSettings.ts
import { useState, useCallback } from "react";

const KEYS = {
  apiKey:  "cogninode_api_key",
  prefs:   "cogninode_prefs",
} as const;

interface Prefs {
  defaultModelId:  string;
  branchMode:      "follow" | "stay";
  customModels:    CustomModel[];
}

const DEFAULT_PREFS: Prefs = {
  defaultModelId: "flash",
  branchMode:     "follow",
  customModels:   [],
};

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEYS.prefs) ?? "{}") };
  } catch { return DEFAULT_PREFS; }
}

export function useSettings() {
  const [apiKey, _setApiKey] = useState(() => localStorage.getItem(KEYS.apiKey) ?? "");
  const [prefs,  _setPrefs]  = useState<Prefs>(loadPrefs);

  const setApiKey = useCallback((key: string) => {
    localStorage.setItem(KEYS.apiKey, key.trim());
    _setApiKey(key.trim());
  }, []);

  const clearApiKey = useCallback(() => {
    localStorage.removeItem(KEYS.apiKey);
    _setApiKey("");
  }, []);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    _setPrefs(prev => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(KEYS.prefs, JSON.stringify(next));
      return next;
    });
  }, []);

  return { apiKey, setApiKey, clearApiKey, prefs, setPref };
}
```

Composer drafts are stored in localStorage too, keyed by `cogninode_draft_${chatId}:${nodeId}`. Small strings, simple access, no Dexie overhead.

### 4.3 Storage limits and warnings

IndexedDB storage is typically 50% of available disk space. Practical limits to communicate to users:

| Item | Size concern |
|---|---|
| Text messages | Negligible |
| Attached images | ~1.33× file size (base64 overhead) — warn above 2MB per file |
| Attached PDFs | Extracted text only — negligible |
| Code files | Text — negligible |

**Show a warning in the UI when total IndexedDB usage exceeds 100MB:**

```typescript
// Rough usage estimate using StorageManager API
async function getStorageEstimate(): Promise<{ usageMb: number; quotaMb: number }> {
  if (!navigator.storage?.estimate) return { usageMb: 0, quotaMb: 0 };
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usageMb: usage / 1_048_576, quotaMb: quota / 1_048_576 };
}
```

**Private/incognito mode:** IndexedDB in private mode is cleared when the window closes. Show a persistent banner in incognito: "⚠ Private mode detected — your chats will not be saved when this window closes."

```typescript
// Detect incognito (not 100% reliable but reasonable)
async function isIncognito(): Promise<boolean> {
  try {
    await navigator.storage.persist();
    const estimate = await navigator.storage.estimate();
    return (estimate.quota ?? 0) < 120_000_000; // < 120MB suggests incognito
  } catch { return false; }
}
```

---

## 5. Model list and cost display

No credits. Real dollar costs from OpenRouter rates, shown directly in the UI.

```typescript
// src/lib/cost.ts

export interface ModelDef {
  id:              string;
  name:            string;
  openRouterId:    string;
  inputPricePerM:  number;   // USD per million input tokens
  outputPricePerM: number;   // USD per million output tokens
  vendor:          string;
  tag:             string;
}

export interface CustomModel extends ModelDef {
  isCustom: true;
}

export const BUILTIN_MODELS: ModelDef[] = [
  { id: "llama",  name: "Llama 3.1 70B",    vendor: "Meta",      tag: "free",
    openRouterId: "meta-llama/llama-3.1-70b-instruct:free",
    inputPricePerM: 0,     outputPricePerM: 0     },
  { id: "flash",  name: "Gemini Flash 2.0",  vendor: "Google",    tag: "budget · fast",
    openRouterId: "google/gemini-flash-2.0",
    inputPricePerM: 0.10,  outputPricePerM: 0.40  },
  { id: "dsv3",   name: "DeepSeek V3",       vendor: "DeepSeek",  tag: "budget · strong",
    openRouterId: "deepseek/deepseek-chat",
    inputPricePerM: 0.32,  outputPricePerM: 0.89  },
  { id: "4omini", name: "GPT-4o Mini",       vendor: "OpenAI",    tag: "value",
    openRouterId: "openai/gpt-4o-mini",
    inputPricePerM: 0.165, outputPricePerM: 0.66  },
  { id: "dsr1",   name: "DeepSeek R1",       vendor: "DeepSeek",  tag: "reasoning",
    openRouterId: "deepseek/deepseek-r1",
    inputPricePerM: 0.605, outputPricePerM: 2.41  },
  { id: "haiku",  name: "Claude Haiku 4.5",  vendor: "Anthropic", tag: "mid",
    openRouterId: "anthropic/claude-haiku-4-5",
    inputPricePerM: 1.10,  outputPricePerM: 5.50  },
  { id: "gpt4o",  name: "GPT-4o",            vendor: "OpenAI",    tag: "premium",
    openRouterId: "openai/gpt-4o",
    inputPricePerM: 2.75,  outputPricePerM: 11.00 },
  { id: "sonnet", name: "Claude Sonnet 4.5", vendor: "Anthropic", tag: "premium",
    openRouterId: "anthropic/claude-sonnet-4-5",
    inputPricePerM: 3.30,  outputPricePerM: 16.50 },
];

// Merged list including user-added custom models from localStorage prefs
export function getAllModels(customModels: CustomModel[] = []): ModelDef[] {
  return [...BUILTIN_MODELS, ...customModels];
}

export function getModel(id: string, customModels: CustomModel[] = []): ModelDef | undefined {
  return getAllModels(customModels).find(m => m.id === id);
}

// ── Cost calculation ───────────────────────────────────────────

export const roughTokens = (text: string): number =>
  Math.ceil((text ?? "").length / 4);

export function calculateCostUsd(
  inputTokens:  number,
  outputTokens: number,
  model:        ModelDef,
): number {
  return (inputTokens  * model.inputPricePerM  / 1_000_000) +
         (outputTokens * model.outputPricePerM / 1_000_000);
}

export function estimateCostUsd(
  composerText: string,
  pathMessages: Array<{ content: string }>,
  model:        ModelDef,
): number {
  const inputTok =
    roughTokens(composerText) +
    pathMessages.reduce((s, m) => s + roughTokens(m.content), 0);
  return calculateCostUsd(inputTok, 550, model);
}

// ── Display formatting ─────────────────────────────────────────

export function formatCost(costUsd: number): string {
  if (costUsd === 0)       return "free";
  if (costUsd < 0.000_1)  return "< $0.0001";
  if (costUsd < 0.01)     return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(3)}`;
}

// In the composer: "~$0.0023" or "~free"
export function formatEstimate(costUsd: number): string {
  return costUsd === 0 ? "~free" : `~${formatCost(costUsd)}`;
}
```

### 5.1 Custom model UI

In the model picker dropdown, after the 8 builtin models:

```
───────────────────────────
+ Add custom model
```

Clicking opens a small form:
- **Display name** (e.g. "Claude Opus 4")
- **OpenRouter model string** (e.g. `anthropic/claude-opus-4`)
- **Input price** $/M tokens
- **Output price** $/M tokens

On save, the custom model is added to `prefs.customModels` in localStorage and appears in the picker immediately. Custom models show a `custom` badge.

---

## 6. API key management

### 6.1 ApiKeyGate

Wraps the entire app. If no API key is stored, shows the setup screen instead of the chat UI.

```typescript
// src/components/setup/ApiKeyGate.tsx
import { useSettings } from "../../hooks/useSettings";

export function ApiKeyGate({ children }: { children: React.ReactNode }) {
  const { apiKey, setApiKey } = useSettings();
  const [input, setInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  if (apiKey) return <>{children}</>;

  async function testAndSave() {
    if (!input.trim()) return;
    setTesting(true);
    setError("");
    try {
      // Verify key with a cheap test call
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "Authorization": `Bearer ${input.trim()}` },
      });
      if (!res.ok) throw new Error("Invalid key");
      setApiKey(input.trim());
    } catch {
      setError("Key didn't work — check it and try again.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="key-gate">
      <div className="key-gate-inner">
        <div className="kg-glyph">{/* Glyph component */}</div>
        <h1>cogninode <em>beta</em></h1>
        <p>
          Paste your{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">
            OpenRouter API key
          </a>
          . It's stored only in your browser — never sent anywhere except OpenRouter.
        </p>
        <input
          type="password"
          placeholder="sk-or-..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && testAndSave()}
          autoFocus
        />
        {error && <p className="kg-error">{error}</p>}
        <button onClick={testAndSave} disabled={testing || !input.trim()}>
          {testing ? "Checking…" : "Connect →"}
        </button>
        <p className="kg-notice">
          🔒 Your key is stored in <code>localStorage</code> on this device.
          Clear it any time in Settings. cogninode is{" "}
          <a href="https://github.com/your-org/cogninode" target="_blank" rel="noopener">
            open source
          </a>{" "}
          — read the code.
        </p>
      </div>
    </div>
  );
}
```

### 6.2 Key display and management in settings

```typescript
// In SettingsModal.tsx
const maskedKey = apiKey
  ? `${apiKey.slice(0, 10)}${"•".repeat(20)}`
  : "Not set";

// Show masked key, a "Reveal" button, and a "Remove key" button
// "Remove key" clears localStorage and returns to ApiKeyGate
```

---

## 7. OpenRouter streaming — direct from browser

```typescript
// src/lib/stream.ts

export type StreamEvent =
  | { type: "chunk";  content: string }
  | { type: "done";   usage: { inputTokens: number; outputTokens: number; costUsd: number } }
  | { type: "error";  message: string; status?: number };

interface StreamParams {
  apiKey:       string;
  openRouterId: string;        // e.g. "anthropic/claude-sonnet-4-5"
  messages:     Array<{ role: string; content: unknown }>;
  onChunk:      (text: string) => void;
  onDone:       (usage: Extract<StreamEvent, { type: "done" }>["usage"]) => void;
  onError:      (msg: string, status?: number) => void;
  signal?:      AbortSignal;
  model:        ModelDef;      // for cost calculation post-stream
}

export async function streamMessage(params: StreamParams): Promise<void> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${params.apiKey}`,
      "HTTP-Referer":  "https://github.com/your-org/cogninode",
      "X-Title":       "cogninode beta",
    },
    body: JSON.stringify({
      model:          params.openRouterId,
      messages:       [
        {
          role: "system",
          content:
            "You are a helpful assistant in cogninode, a tree-shaped AI chat. " +
            "The user is working in a branch of a larger conversation. " +
            "Be precise and concise. Avoid preamble.",
        },
        ...params.messages,
      ],
      stream:         true,
      stream_options: { include_usage: true },
      max_tokens:     4096,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    // OpenRouter returns structured errors — parse for better messages
    let message = `HTTP ${response.status}`;
    try {
      const err = JSON.parse(body);
      message = err.error?.message ?? message;
      // Common errors
      if (response.status === 401) message = "Invalid API key. Check Settings.";
      if (response.status === 402) message = "Insufficient OpenRouter credits.";
      if (response.status === 429) message = "Rate limited. Wait a moment.";
    } catch { /* use raw body */ }
    params.onError(message, response.status);
    return;
  }

  const reader  = response.body!.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";
  let   inputTokens  = 0;
  let   outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const line = event.split("\n").find(l => l.startsWith("data: "));
        if (!line) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;

        try {
          const parsed = JSON.parse(raw);
          const delta  = parsed.choices?.[0]?.delta?.content;
          if (delta) params.onChunk(delta);
          if (parsed.usage) {
            inputTokens  = parsed.usage.prompt_tokens     ?? 0;
            outputTokens = parsed.usage.completion_tokens ?? 0;
          }
        } catch { /* skip malformed */ }
      }
    }

    params.onDone({
      inputTokens,
      outputTokens,
      costUsd: calculateCostUsd(inputTokens, outputTokens, params.model),
    });
  } finally {
    reader.releaseLock();
  }
}
```

### 7.1 useStream hook

```typescript
// src/hooks/useStream.ts
import { useState, useCallback, useRef } from "react";
import { streamMessage }                  from "../lib/stream";
import { buildPathMessages, db }          from "../lib/db";
import { getModel }                       from "../lib/cost";
import { useSettings }                    from "./useSettings";

type StreamState = "idle" | "streaming" | "error";

export function useStream(chatId: string, nodeId: string) {
  const [state,         setState]         = useState<StreamState>("idle");
  const [streamingText, setStreamingText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const { apiKey, prefs } = useSettings();

  const send = useCallback(async (params: {
    modelId:      string;
    composerText: string;
    quote?:       string;
    fileIds?:     string[];
  }) => {
    if (state === "streaming") return;

    const model = getModel(params.modelId, prefs.customModels);
    if (!model) return;

    setState("streaming");
    setStreamingText("");
    abortRef.current = new AbortController();

    // Persist user message to Dexie first
    const userMsgId = crypto.randomUUID();
    await db.messages.add({
      _id:       userMsgId,
      nodeId,
      chatId,
      role:      "user",
      content:   params.composerText,
      quote:     params.quote,
      fileIds:   params.fileIds ?? [],
      createdAt: Date.now(),
    });

    // Build path context from Dexie
    const pathMessages = await buildPathMessages(chatId, nodeId);
    // Remove the message we just added (it's already the last user msg)
    const contextMessages = pathMessages.slice(0, -1);

    let fullContent = "";

    await streamMessage({
      apiKey,
      openRouterId: model.openRouterId,
      messages: contextMessages,
      model,
      signal: abortRef.current.signal,

      onChunk: (text) => {
        fullContent += text;
        setStreamingText(prev => prev + text);
      },

      onDone: async ({ inputTokens, outputTokens, costUsd }) => {
        // Persist assistant message
        await db.messages.add({
          _id:          crypto.randomUUID(),
          nodeId,
          chatId,
          role:         "assistant",
          content:      fullContent,
          modelId:      params.modelId,
          costUsd,
          inputTokens,
          outputTokens,
          pathDepth:    contextMessages.length,
          createdAt:    Date.now(),
        });

        // Update chat's updatedAt
        await db.chats.update(chatId, { updatedAt: Date.now() });

        setState("idle");
        setStreamingText("");
      },

      onError: async (msg) => {
        // Remove the user message we persisted if the stream failed
        await db.messages.delete(userMsgId);
        setState("error");
        setStreamingText("");
        console.error("Stream error:", msg);
      },
    });
  }, [state, chatId, nodeId, apiKey, prefs.customModels]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState("idle");
    setStreamingText("");
  }, []);

  return { state, streamingText, send, cancel };
}
```

---

## 8. Cost estimate in the composer

```typescript
// src/hooks/useCostEstimate.ts
import { useMemo }                              from "react";
import { useLiveQuery }                         from "dexie-react-hooks";
import { db }                                   from "../lib/db";
import { estimateCostUsd, roughTokens, getModel } from "../lib/cost";
import { useSettings }                          from "./useSettings";

export function useCostEstimate(
  composerText: string,
  nodeId:       string,
  chatId:       string,
  modelId:      string,
): number {
  const { prefs } = useSettings();
  const model     = getModel(modelId, prefs.customModels);

  // Get all nodes to build path, reactive via useLiveQuery
  const pathDepth = useLiveQuery(async () => {
    const allNodes = await db.nodes.where("chatId").equals(chatId).toArray();
    const nodeMap  = new Map(allNodes.map(n => [n._id, n]));
    let depth = 0, currentId: string | null = nodeId;
    while (currentId) {
      const node = nodeMap.get(currentId);
      if (!node) break;
      depth++;
      currentId = node.parentId;
    }
    return depth;
  }, [chatId, nodeId]) ?? 1;

  return useMemo(() => {
    if (!model) return 0;
    // Approximate path context: pathDepth nodes × 400 chars each
    const approxPathChars = Math.max(0, pathDepth - 1) * 400;
    const pathMessages = [{ content: "x".repeat(approxPathChars) }];
    return estimateCostUsd(composerText, pathMessages, model);
  }, [composerText, pathDepth, model]);
}
```

**Display in the composer footer:**

```tsx
// In Composer.tsx
const estimatedCost = useCostEstimate(value, nodeId, chatId, modelId);
const costLabel     = formatEstimate(estimatedCost);

// Cost pill: green for free, amber for < $0.01, red for >= $0.01
const pillClass =
  estimatedCost === 0      ? "cost-free" :
  estimatedCost < 0.01     ? "cost-mid"  : "cost-high";

// "~$0.0018" or "~free" in the composer footer, next to the model picker
<span className={`cost-pill ${pillClass}`}>{costLabel}</span>
```

**Post-send on the assistant message:**

```tsx
// In Message.tsx
{msg.costUsd !== undefined && (
  <span className="msg-cost">
    {formatCost(msg.costUsd)}
    {msg.inputTokens && (
      <span className="msg-cost-detail">
        {" "}· {msg.inputTokens.toLocaleString()} in
        + {msg.outputTokens?.toLocaleString()} out
        · {msg.pathDepth}-node path
      </span>
    )}
  </span>
)}
```

---

## 9. File attachments — client-side only

```typescript
// src/lib/files.ts
import { db, type StoredFile, newId } from "./db";

export function inferKind(file: File): StoredFile["kind"] {
  if (file.type.startsWith("image/"))           return "image";
  if (file.type === "application/pdf")          return "pdf";
  if (/\.(ts|tsx|js|jsx|py|go|rs|rb|java|c|cpp|cs|php|swift|kt)$/i.test(file.name))
    return "code";
  return "file";
}

// Convert file to storable content
async function readFileContent(file: File, kind: StoredFile["kind"]): Promise<string> {
  if (kind === "image") {
    // Base64 data URL — sent directly to OpenRouter as image_url
    return new Promise((resolve, reject) => {
      const reader  = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  if (kind === "pdf") {
    // Extract text with pdf.js (loaded on demand)
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";
    const buffer = await file.arrayBuffer();
    const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item: any) => item.str).join(" "));
    }
    return pages.join("\n\n");
  }

  // Code and other text files
  return file.text();
}

export interface ProcessedFile {
  fileId:       string;
  name:         string;
  kind:         StoredFile["kind"];
  sizeBytes:    number;
  // For non-image files, the text content to append to the composer
  textToAppend?: string;
}

// Store file in Dexie and return metadata
export async function storeFile(file: File): Promise<ProcessedFile> {
  const kind    = inferKind(file);
  const content = await readFileContent(file, kind);
  const fileId  = newId();

  await db.files.add({
    _id:       fileId,
    name:      file.name,
    kind,
    mimeType:  file.type,
    sizeBytes: file.size,
    content,
    createdAt: Date.now(),
  });

  return {
    fileId,
    name:  file.name,
    kind,
    sizeBytes: file.size,
    // Non-image files: inject content into composer as a block
    textToAppend:
      kind === "pdf"
        ? `\n\n<document name="${file.name}">\n${content}\n</document>`
        : kind === "code"
        ? `\n\n\`\`\`${getExtension(file.name)}\n${content}\n\`\`\``
        : undefined,
  };
}

function getExtension(filename: string): string {
  return filename.split(".").pop() ?? "";
}
```

**Size warning in the Composer:**

```typescript
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB

if (file.type.startsWith("image/") && file.size > MAX_IMAGE_BYTES) {
  // Show warning: "Image is large (X MB) and will increase your IndexedDB storage.
  //               Proceed anyway?"
}
```

---

## 10. JSON export and import

```typescript
// src/lib/export.ts
import { db } from "./db";

const EXPORT_VERSION = 1;

export interface ExportPayload {
  version:     number;
  exportedAt:  number;
  chats:       Awaited<ReturnType<typeof db.chats.toArray>>;
  nodes:       Awaited<ReturnType<typeof db.nodes.toArray>>;
  messages:    Awaited<ReturnType<typeof db.messages.toArray>>;
  reflections: Awaited<ReturnType<typeof db.reflections.toArray>>;
  files:       Awaited<ReturnType<typeof db.files.toArray>>;
}

// ── Export ────────────────────────────────────────────────────

export async function exportAllChats(): Promise<void> {
  const payload: ExportPayload = {
    version:     EXPORT_VERSION,
    exportedAt:  Date.now(),
    chats:       await db.chats.toArray(),
    nodes:       await db.nodes.toArray(),
    messages:    await db.messages.toArray(),
    reflections: await db.reflections.toArray(),
    files:       await db.files.toArray(),   // includes base64 images — can be large
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const date = new Date().toISOString().split("T")[0];
  a.href     = url;
  a.download = `cogninode-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Import ────────────────────────────────────────────────────

export async function importFromJson(file: File): Promise<{
  chatsAdded: number;
  skipped:    number;
}> {
  const text = await file.text();
  const payload = JSON.parse(text) as ExportPayload;

  if (!payload.version || payload.version > EXPORT_VERSION) {
    throw new Error(`Unsupported backup version: ${payload.version}`);
  }

  // Find existing IDs to detect conflicts
  const existingChatIds = new Set(await db.chats.toCollection().primaryKeys());

  const newChats = payload.chats.filter(c => !existingChatIds.has(c._id));
  const newChatIds = new Set(newChats.map(c => c._id));

  // Only import data that belongs to new chats (avoid overwriting existing data)
  const newNodes       = payload.nodes.filter(n => newChatIds.has(n.chatId));
  const newMessages    = payload.messages.filter(m => newChatIds.has(m.chatId));
  const newReflections = payload.reflections.filter(r => newChatIds.has(r.chatId));

  // For files: import only those referenced by new messages
  const newFileIds = new Set(
    newMessages.flatMap(m => m.fileIds ?? [])
  );
  const newFiles = (payload.files ?? []).filter(f => newFileIds.has(f._id));

  await db.transaction(
    "rw",
    db.chats, db.nodes, db.messages, db.reflections, db.files,
    async () => {
      await db.chats.bulkAdd(newChats);
      await db.nodes.bulkAdd(newNodes);
      await db.messages.bulkAdd(newMessages);
      await db.reflections.bulkAdd(newReflections);
      await db.files.bulkAdd(newFiles);
    }
  );

  return {
    chatsAdded: newChats.length,
    skipped:    payload.chats.length - newChats.length,
  };
}
```

**Import UX:** file input `<input type="file" accept=".json">` in Settings. On success, show a toast: "Imported 12 chats. 3 skipped (already existed)." On error, show the error message. The import merges — it never deletes existing data.

---

## 11. Full feature parity with production spec

All of the following are implemented identically to the production spec, reading from Dexie instead of Convex:

**Sidebar tree:** `useLiveQuery(() => db.nodes.where("chatId").equals(activeChatId).toArray())`. Collapse state in localStorage.

**QuickJump (⌃Q):** fuzzy-search over all nodes across all chats from Dexie. Same palette UI.

**Tree map (⌃T):** same layout algorithm (DFS coordinate computation), reading nodes from Dexie. Click to set `currentNodeId` via `db.chats.update`.

**Reflections (⌃R):** edit/delete/merge messages in Dexie directly. `db.messages.update` / `db.messages.delete`. Save as reflection: `db.reflections.put`.

**Branching:** `createBranch()` from `db.ts` (section 4.1). Selection popup triggers it. Quote chip stored on the first user message in the new node.

**Keyboard shortcuts:** all shortcuts from the production spec work identically. No backend calls needed for any of them.

**Node label:** first 60 chars of the quote text, or first 60 chars of the first user message content. Set on `createBranch` / on the first message add.

---

## 12. Settings modal

Accessible via gear icon in the sidebar footer. Covers:

```
Settings
├── API key (masked, reveal button, remove button)
├── Default model (radio list)
├── Branch mode (follow / stay)
├── Custom models
│   ├── List of added custom models (delete button per row)
│   └── Add custom model form (name, model string, input price, output price)
├── Data
│   ├── Export all chats (JSON)
│   ├── Import from backup (file picker)
│   └── Clear all data (confirmation dialog)
└── About
    ├── Version
    └── GitHub link
```

**Clear all data** empties all Dexie tables and removes localStorage prefs. Shows a "Type DELETE to confirm" dialog. Returns to ApiKeyGate (since the key is also cleared).

---

## 13. First-run experience

1. User opens `http://localhost:5173`
2. ApiKeyGate renders — enter and verify key
3. Key saved to localStorage
4. Chat list shows empty state: "No chats yet. Press ⌃N to start your first tree."
5. User creates chat — types first message — stream starts
6. First assistant reply shows cost: "$0.0003" — user sees they're spending their own credits

No sign-up, no email, no onboarding flow. The key entry is the entire setup.

---

## 14. Vite config

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react            from "@vitejs/plugin-react";
import { resolve }      from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  // pdf.js worker file — served as a static asset
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["pdfjs-dist"],   // dynamic import — don't pre-bundle
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          dexie:  ["dexie", "dexie-react-hooks"],
        },
      },
    },
  },
});
```

---

## 15. TypeScript config

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target":                     "ES2022",
    "lib":                        ["ES2022", "DOM", "DOM.Iterable"],
    "module":                     "ESNext",
    "moduleResolution":           "Bundler",
    "strict":                     true,
    "noUncheckedIndexedAccess":   true,
    "exactOptionalPropertyTypes": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

---

## 16. Package list

```json
{
  "name":    "cogninode",
  "version": "0.1.0-beta",
  "license": "MIT",
  "dependencies": {
    "react":             "^18.3",
    "react-dom":         "^18.3",
    "react-router-dom":  "^6",
    "dexie":             "^4",
    "dexie-react-hooks": "^1.1",
    "pdfjs-dist":        "^4"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "latest",
    "vite":                 "^5",
    "typescript":           "^5",
    "@types/react":         "latest",
    "@types/react-dom":     "latest"
  }
}
```

No Convex. No Clerk. No Razorpay. No auth libraries. No state management. No HTTP client.

---

## 17. README structure

```markdown
# cogninode — beta

> Think with AI, not at it.

Tree-shaped AI chat. Branch any reply, jump anywhere, pay only for the 
tokens on the path you're standing on. Open source, runs in your browser,
uses your own OpenRouter key.

## What's this

The beta is a fully local, open source version of cogninode. All data 
lives in your browser's IndexedDB. Nothing is sent to any server except 
your AI requests to OpenRouter.

## Getting started

Prerequisites: Node.js 18+, an OpenRouter account.

git clone https://github.com/your-org/cogninode
cd cogninode
npm install
npm run dev

Open http://localhost:5173. Paste your OpenRouter API key when prompted.

## Your data

Everything is stored in IndexedDB in your browser.
- Export your chats: Settings → Export
- Import a backup: Settings → Import
- Clear everything: Settings → Clear all data

## ⚠ Storage warnings

- Images attached to messages are stored as base64. Large images 
  (> 2MB) will slow down the app.
- In private/incognito mode, IndexedDB is cleared when you close 
  the window.
- The app does not sync between devices or browsers.

## Contributing

MIT licensed. PRs welcome.
Issues: https://github.com/your-org/cogninode/issues

## Acknowledgements

Models via OpenRouter. PDF extraction via pdf.js.
```

---

## 18. Build order

```
1. src/lib/cost.ts              — models, cost formula, formatCost; test in isolation
2. src/lib/db.ts                — Dexie schema; open app and inspect IndexedDB in DevTools
3. src/hooks/useSettings.ts     — API key round-trip; localStorage in DevTools
4. src/components/setup/
   ApiKeyGate.tsx               — verify key call to OpenRouter /models works
5. src/lib/stream.ts            — test a streaming call in the browser console:
                                  copy-paste the function and call it directly
6. src/hooks/useStream.ts       — React wrapper; send one message end-to-end
7. pages/Chat.tsx + ChatApp.tsx — basic chat UI reading from Dexie
8. Sidebar.tsx                  — useLiveQuery for chat and node lists
9. Composer.tsx + cost estimate — full interaction loop
10. src/lib/files.ts            — test each file type separately
11. Overlays.tsx                — QuickJump, TreeMap (same logic as production)
12. Reflections mode            — edit/delete/merge in Dexie
13. src/lib/export.ts           — export then import, verify data is identical
14. SettingsModal.tsx           — custom models, key management, export/import UI
15. README.md                   — write it last, when the app actually works
```

**Browser console test for the stream (step 5):**

```javascript
// Paste in browser console after opening the app
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_KEY_HERE",
  },
  body: JSON.stringify({
    model: "google/gemini-flash-2.0",
    messages: [{ role: "user", content: "Say hello in 5 words." }],
    stream: true,
  }),
});
const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(new TextDecoder().decode(value));
}
```

If you see SSE chunks in the console, streaming works from the browser. No CORS issues, key is valid.

---

## 19. Key decisions

| Decision | Why |
|---|---|
| Dexie over localStorage | Messages grow large. localStorage's 5-10MB limit is hit fast with real use. Dexie gives structured queries and `useLiveQuery`. |
| Dexie over OPFS | Better browser support. OPFS (Origin Private File System) is faster but Safari support is still patchy and the API is lower-level. Reconsider for v2 if performance is a complaint. |
| Files stored inline in Dexie | No server storage option exists. base64 for images, text for PDFs/code. Warn users about size. Separate `files` table keeps messages lean. |
| Direct OpenRouter fetch from browser | OpenRouter supports browser CORS for user keys. No proxy needed. Simpler than any alternative. |
| USD cost display, not credits | Credits are a cogninode invention to abstract API costs. In the beta, users pay OpenRouter directly — show them the real number. |
| Custom model text input | Technical open source users will want models not in the curated list. A text field plus price inputs is trivial to build and unlocks the full OpenRouter catalogue. |
| JSON export only (no markdown) | Markdown export requires rendering decisions about tree structure. JSON is lossless and re-importable. Markdown export is V2. |
| Import merges, never overwrites | Safest behaviour. Users who import into a non-empty app expect additive behaviour. "Already existed: 3 skipped" is understandable. Silent overwrite is not. |
| No offline queue | No backend to sync to. Everything is already local. Writes to Dexie are synchronous from the user's perspective. The production spec's sync queue is irrelevant here. |
