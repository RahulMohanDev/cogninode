# cogninode — beta

> Think with AI, not at it.

Tree-shaped AI chat. Branch any reply, jump anywhere, pay only for the
tokens on the path you're standing on. Open source, runs entirely in your
browser, uses your own OpenRouter key.

## What is this

A fully client-side React app. All chat data lives in your browser's
IndexedDB. The only network requests are streaming calls to OpenRouter,
authenticated with the API key you paste in on first run. No backend,
no account, no telemetry.

## Quick start

Prerequisites: Node.js 18+ and an OpenRouter account.

```sh
git clone https://github.com/rahulmohan/cogninode
cd cogninode
npm install
npm run dev
```

Open <http://localhost:5173> and paste your OpenRouter key when prompted.

## Get an OpenRouter key

1. Go to <https://openrouter.ai/keys>.
2. Sign in, click **Create key**, copy the `sk-or-v1-…` value.
3. Add a few dollars of credit at <https://openrouter.ai/credits> so the
   builtin models work — the free Llama tier is also available.
4. Paste the key into cogninode's setup screen. It's verified against
   `GET /api/v1/models` and then stored in this browser's `localStorage`
   under `cogninode_api_key`. Nothing is sent anywhere else.

## Your data lives in your browser

Everything is in IndexedDB (database name `cogninode`, tables: `chats`,
`nodes`, `messages`, `reflections`, `files`). Composer drafts and
preferences sit in `localStorage`.

- **Export:** Settings → Export JSON → downloads `cogninode-backup-YYYY-MM-DD.json`
  with every chat, node, message, reflection, and file.
- **Import:** Settings → Import → pick a backup JSON. Existing chats are
  preserved; only new chats are merged in.
- **Clear all:** Settings → Clear all data → type `DELETE` → wipes IndexedDB
  and the API key. Cannot be undone.

## Storage warnings

| Concern | Status |
|---|---|
| Images attached to messages are stored as base64; > 2 MB images slow things down | UI: confirm prompt on attach |
| Private/incognito mode discards IndexedDB when the window closes | Documentation only (v0 gap) |
| Total IndexedDB usage > 100 MB | Documentation only (v0 gap) |
| No cross-device or cross-browser sync — use export/import to move data | Documentation only |

## Features

- Tree-shaped chat: branch any reply, path-only context, sidebar tree view
- Selection popup for "Branch from selection" — quote travels into the new node
- Reflections-style in-place message edit
- Tree map overlay, quick-jump palette, keyboard shortcut sheet
- File attachments: images (sent as `image_url`), PDFs (text extracted with
  pdf.js), code (fenced inline)
- Real-time per-message cost display in USD; live pre-send estimate
- 8 built-in models plus user-defined custom OpenRouter models
- JSON export/import; clear-all data wipe
- Live token + cost accounting from OpenRouter streaming `usage`

## Keyboard shortcuts

| Keys | Action |
|---|---|
| ⌃N | New chat |
| ⌃Q or ⌘K | Open quick-jump |
| ⌃T | Open tree map |
| ⌃? or ⇧? | Shortcut cheat sheet |
| ⌃, | Open settings |
| ⌃↵ | Send composer |
| ⇧↵ | New line in composer |
| Esc | Close any open overlay |

Note: ⌃N and ⌃, are advertised on the cheat sheet but are not yet wired
to global handlers — see "Known limitations" below.

## Known limitations (v0 gaps)

- **Reflections mode toggle (⌃R)** — the cheat-sheet entry exists, but
  there's no global hotkey. You can still edit/save individual messages
  via the pencil icon in each message's hover actions.
- **⌃N (new chat) and ⌃, (settings)** — no global hotkey handlers; use the
  sidebar's *New chat* button and gear icon respectively.
- **Storage banner** — no in-app banner for incognito mode or for
  IndexedDB usage > 100 MB. Use a normal (non-private) browser window and
  keep an eye on attached image sizes.
- **Stream cancel leaves orphan user message** — pressing Stop while a
  reply is streaming will keep your sent user message in the chat (the
  assistant reply is simply absent). Send again to retry.

## Architecture in a nutshell

- **React 18 + React Router** for the SPA shell; everything renders from
  Dexie via `useLiveQuery`.
- **Dexie 4** wraps IndexedDB; writes flow through small helpers in
  `src/lib/db.ts`. Reads are live and automatic.
- **OpenRouter** is called directly from the browser with
  `fetch(..., { stream: true })`. The `useStream` hook persists the user
  message, builds path context, pipes SSE chunks into local state, then
  writes the completed assistant message with `usage`-derived cost.

See `cogninode-beta-spec.md` for the full design doc.

## Tech stack

React 18 · TypeScript (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`) · Vite 5 · Dexie 4 · `dexie-react-hooks` ·
pdf.js. No backend, no auth library, no state manager, no HTTP client.

## Contributing

MIT licensed. PRs welcome.
Issues: <https://github.com/rahulmohan/cogninode/issues>

## Acknowledgements

Model routing via [OpenRouter](https://openrouter.ai). Client-side PDF
text extraction via [pdf.js](https://mozilla.github.io/pdf.js/).
