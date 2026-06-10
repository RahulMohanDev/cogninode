// src/components/search/SearchOverlay.tsx
// ⌘K / ⌃K — search EVERYTHING: message bodies, reflections, branch labels,
// chat titles. Mounted once at the App level so it works on every page.
// Results are hybrid (BM25 keyword + semantic when the background-loaded
// embedding model is ready), grouped by chat, with highlighted snippets;
// Enter deep-links to the exact message and flashes it.
//
// Also owns the search-service bootstrap: builds the keyword index at boot
// and reconciles the semantic layer with prefs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { searchService, type ResolvedHit } from "../../lib/search/service";
import { useSearchState, semanticStatusLabel } from "../../hooks/useSearchState";
import { useModalBehavior, anyModalOpen } from "../../hooks/useModalStack";
import { useSettings } from "../../hooks/useSettings";
import type { Snippet } from "../../lib/search/snippets";

const DEBOUNCE_MS = 160;

type Row =
  | { type: "header"; chatId: string; chatTitle: string }
  | { type: "hit"; hit: ResolvedHit; flatIndex: number };

function groupRows(hits: ResolvedHit[]): { rows: Row[]; flat: ResolvedHit[] } {
  const order: string[] = [];
  const byChat = new Map<string, ResolvedHit[]>();
  for (const h of hits) {
    if (!byChat.has(h.chatId)) {
      byChat.set(h.chatId, []);
      order.push(h.chatId);
    }
    byChat.get(h.chatId)!.push(h);
  }
  const rows: Row[] = [];
  const flat: ResolvedHit[] = [];
  for (const chatId of order) {
    const group = byChat.get(chatId)!;
    rows.push({ type: "header", chatId, chatTitle: group[0]!.chatTitle });
    for (const hit of group) {
      rows.push({ type: "hit", hit, flatIndex: flat.length });
      flat.push(hit);
    }
  }
  return { rows, flat };
}

function HighlightedSnippet({ snippet }: { snippet: Snippet }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  snippet.ranges.forEach(([s, e], i) => {
    if (s > cursor) parts.push(snippet.text.slice(cursor, s));
    parts.push(
      <mark key={i} className="tw:bg-[color-mix(in_oklab,var(--butter)_45%,transparent)] tw:text-ink tw:rounded-[3px] tw:px-px">
        {snippet.text.slice(s, e)}
      </mark>,
    );
    cursor = e;
  });
  if (cursor < snippet.text.length) parts.push(snippet.text.slice(cursor));
  return (
    <span>
      {snippet.leading ? "…" : ""}{parts}{snippet.trailing ? "…" : ""}
    </span>
  );
}

const KIND_LABEL: Record<ResolvedHit["kind"], string> = {
  message:    "message",
  reflection: "reflection",
  node:       "branch",
  chat:       "chat",
};

function KindIcon({ kind }: { kind: ResolvedHit["kind"] }) {
  if (kind === "reflection") {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M1.8 8 C4 4.7 12 4.7 14.2 8 C12 11.3 4 11.3 1.8 8 Z" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  if (kind === "node" || kind === "chat") {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="3" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="13" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 4.6 V8 M8 8 L3 11.4 M8 8 L13 11.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 3.5 H13.5 V11 H8.5 L5.5 13.5 V11 H2.5 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchOverlay() {
  const navigate = useNavigate();
  const { prefs } = useSettings();
  const searchState = useSearchState();

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ResolvedHit[]>([]);
  const [tookMs, setTookMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryRun = useRef(0);

  // ── service bootstrap: keyword index at boot + semantic per prefs ──
  useEffect(() => {
    void searchService.configure({
      semanticSearch:   prefs.semanticSearch,
      embeddingModelId: prefs.embeddingModelId,
    });
  }, [prefs.semanticSearch, prefs.embeddingModelId]);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    setHi(0);
  }, []);

  useModalBehavior(open, close, panelRef);

  // ⌘K / ⌃K toggle — global, but stands down when a foreign modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl || (e.key !== "k" && e.key !== "K")) return;
      if (anyModalOpen() && !open) return;
      e.preventDefault();
      setOpen(v => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced querying.
  useEffect(() => {
    if (!open) return undefined;
    const needle = q.trim();
    if (!needle) {
      setHits([]);
      setBusy(false);
      return undefined;
    }
    setBusy(true);
    const run = ++queryRun.current;
    const t = setTimeout(() => {
      void searchService.search(needle).then(res => {
        if (queryRun.current !== run) return;
        setHits(res.hits);
        setTookMs(res.tookMs);
        setBusy(false);
        setHi(0);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, open]);

  const { rows, flat } = useMemo(() => groupRows(hits), [hits]);

  const openHit = useCallback((hit: ResolvedHit) => {
    switch (hit.kind) {
      case "message":
        navigate(`/chat/${hit.chatId}?node=${hit.nodeId}&msg=${hit.rawId}`);
        break;
      case "reflection":
        navigate(`/reflections?open=${hit.rawId}`);
        break;
      case "node":
        navigate(`/chat/${hit.chatId}?node=${hit.nodeId}`);
        break;
      case "chat":
        navigate(`/chat/${hit.chatId}`);
        break;
    }
    close();
  }, [navigate, close]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi(h => Math.min(flat.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi(h => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[hi];
      if (hit) openHit(hit);
    }
  };

  if (!open) return null;

  const status = semanticStatusLabel(searchState);
  const statusTone =
    searchState.semantic === "ready" ? "tw:text-teal" :
    searchState.semantic === "error" ? "tw:text-coral" : "tw:text-ink-3";

  return (
    <div className="tw:fixed tw:inset-0 tw:bg-[color-mix(in_oklab,var(--ink)_30%,transparent)] tw:dark:bg-[var(--veil-black-60)] tw:backdrop-blur-[8px] tw:grid tw:[place-items:start_center] tw:pt-[12vh] tw:z-[200] tw:animate-[fadeIn_0.14s_ease-out]" onClick={close}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="tw:w-[min(680px,92vw)] tw:bg-bg-3 tw:border tw:border-line tw:rounded-[16px] tw:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.4)] tw:overflow-hidden tw:animate-[popUp_0.18s_cubic-bezier(0.34,1.56,0.64,1)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="tw:flex tw:items-center tw:gap-2.5 tw:py-3.5 tw:px-[18px] tw:border-b tw:border-line tw:[&_svg]:flex-none">
          <svg className="tw:text-ink-3" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            className="tw:flex-1 tw:border-none tw:bg-transparent tw:outline-none tw:text-[15px] tw:text-ink"
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search messages, reflections, branches…"
            spellCheck={false}
            autoComplete="off"
          />
          <span
            className={`tw:font-mono tw:text-[10px] tw:py-0.5 tw:px-[7px] tw:rounded-[999px] tw:bg-bg-2 tw:flex-none ${statusTone}`}
            title={searchState.error ?? `${searchState.docCount} docs indexed · ${searchState.vectorCount} vectors`}
          >
            {status}
          </span>
        </div>

        <div className="tw:max-h-[56vh] tw:overflow-y-auto tw:p-1.5 tw:[scrollbar-width:thin] tw:[scrollbar-color:var(--line)_transparent]">
          {q.trim() === "" ? (
            <div className="tw:py-9 tw:px-[18px] tw:text-center tw:text-ink-3 tw:text-[13px]">
              Type to search everything — message bodies included.
            </div>
          ) : flat.length === 0 && !busy ? (
            <div className="tw:py-9 tw:px-[18px] tw:text-center tw:text-ink-3 tw:text-[13px]">
              No matches for "{q.trim()}".
            </div>
          ) : (
            rows.map(row => {
              if (row.type === "header") {
                return (
                  <div key={`h:${row.chatId}`} className="tw:font-mono tw:text-[9px] tw:tracking-[0.14em] tw:uppercase tw:text-ink-3 tw:pt-2.5 tw:px-3 tw:pb-1 tw:truncate">
                    {row.chatTitle || "Untitled chat"}
                  </div>
                );
              }
              const { hit, flatIndex } = row;
              const active = flatIndex === hi;
              const semanticOnly = hit.sources.length === 1 && hit.sources[0] === "semantic";
              return (
                <div
                  key={hit.docId}
                  className={`tw:flex tw:items-start tw:gap-2.5 tw:py-2 tw:px-3 tw:rounded-[8px] tw:cursor-pointer ${active ? "tw:bg-bg-2" : "tw:hover:bg-bg-2"}`}
                  onClick={() => openHit(hit)}
                  onMouseEnter={() => setHi(flatIndex)}
                >
                  <span className="tw:text-ink-3 tw:mt-[3px] tw:flex-none"><KindIcon kind={hit.kind} /></span>
                  <span className="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-px">
                    <span className="tw:flex tw:items-center tw:gap-1.5 tw:min-w-0">
                      <span className="tw:font-mono tw:text-[9px] tw:tracking-[0.1em] tw:uppercase tw:text-ink-3 tw:flex-none">
                        {hit.kind === "message" ? (hit.role ?? "message") : KIND_LABEL[hit.kind]}
                      </span>
                      {hit.title && (
                        <span className="tw:text-[13px] tw:font-medium tw:text-ink tw:truncate">{hit.title}</span>
                      )}
                      {semanticOnly && (
                        <span className="tw:font-mono tw:text-[9px] tw:text-lilac tw:flex-none" title="Found by meaning, not keywords">≈ meaning</span>
                      )}
                    </span>
                    {hit.snippet && hit.snippet.text && (
                      <span className="tw:text-[12.5px] tw:text-ink-2 tw:leading-[1.45] tw:[overflow-wrap:anywhere]">
                        <HighlightedSnippet snippet={hit.snippet} />
                      </span>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="tw:flex tw:items-center tw:gap-3.5 tw:py-2.5 tw:px-[18px] tw:border-t tw:border-line tw:font-mono tw:text-[10px] tw:text-ink-3 tw:tracking-[0.04em]">
          <span><kbd className="tw:font-mono tw:text-[10px] tw:bg-bg-2 tw:border tw:border-line tw:py-px tw:px-[5px] tw:rounded-[3px] tw:text-ink-2">↑↓</kbd> navigate</span>
          <span><kbd className="tw:font-mono tw:text-[10px] tw:bg-bg-2 tw:border tw:border-line tw:py-px tw:px-[5px] tw:rounded-[3px] tw:text-ink-2">↵</kbd> open</span>
          <span><kbd className="tw:font-mono tw:text-[10px] tw:bg-bg-2 tw:border tw:border-line tw:py-px tw:px-[5px] tw:rounded-[3px] tw:text-ink-2">esc</kbd> close</span>
          <span className="tw:ml-auto">
            {busy ? "searching…" : flat.length > 0 ? `${flat.length} results · ${tookMs}ms` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

export default SearchOverlay;