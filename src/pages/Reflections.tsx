// src/pages/Reflections.tsx
// Browser for saved reflections — the snapshots created via reflections
// mode (⌃R → "Save as reflection"). Before this page existed reflections
// were write-only: stored in Dexie and exported in backups, but with no UI
// to read, edit, or delete them.
//
// Master-detail: searchable list on the left, rendered markdown on the
// right with rename / edit-body (lazy Tiptap editor, same chunk Message.tsx
// uses) / delete / jump-to-source-branch.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";

import { db, deleteReflection, type Reflection } from "../lib/db";
import { Sidebar }             from "../components/chat/Sidebar";
import { SettingsModal }       from "../components/settings/SettingsModal";
import { MarkdownBody }        from "../components/chat/MarkdownBody";
import { AddToGraphDialog, type AddToGraphTarget } from "../components/graph/AddToGraphDialog";
import { useSettings }         from "../hooks/useSettings";
import { useSettingsHotkey }   from "../hooks/useSettingsHotkey";
import { useToast }            from "../components/ui/Toast";

const RichEditor = lazy(() => import("../lib/markdown"));

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min  = Math.floor(diff / 60_000);
  if (min < 1)  return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7)    return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Reflections() {
  const navigate = useNavigate();
  const { prefs } = useSettings();
  const toast = useToast();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [graphTarget, setGraphTarget]   = useState<AddToGraphTarget | null>(null);

  useSettingsHotkey(() => setSettingsOpen(true));

  // ?open=<id> deep link (from the ⌘K search palette).
  const [searchParams] = useSearchParams();
  const openParam = searchParams.get("open");
  useEffect(() => {
    if (openParam) setSelectedId(openParam);
  }, [openParam]);

  // No updatedAt index on the reflections table — sort in memory. Counts
  // stay small (these are hand-curated snapshots, not messages).
  const reflections = useLiveQuery(
    async () => {
      const all = await db.reflections.toArray();
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    [],
  );

  const chats = useLiveQuery(() => db.chats.toArray(), []);
  const chatTitleById = useMemo(
    () => new Map((chats ?? []).map(c => [c._id, c.title])),
    [chats],
  );

  const selected = useMemo(
    () => (reflections ?? []).find(r => r._id === selectedId) ?? null,
    [reflections, selectedId],
  );

  // The sidebar owns browsing/search now — this page is the full-width
  // reader. Land on the newest reflection by default, and fall back to it
  // when the open one disappears (deleted from the sidebar).
  useEffect(() => {
    if (!reflections) return;
    if (selectedId && reflections.some(r => r._id === selectedId)) return;
    setSelectedId(reflections[0]?._id ?? null);
  }, [reflections, selectedId]);

  return (
    <div className={`tw:grid tw:h-dvh tw:w-screen tw:transition-[grid-template-columns] tw:duration-[220ms] tw:ease-[cubic-bezier(0.4,0,0.2,1)] tw:motion-reduce:transition-none ${prefs.sidebarCollapsed ? "tw:grid-cols-[60px_1fr]" : "tw:grid-cols-[268px_1fr]"}`}>
      <Sidebar
        activeChatId={null}
        mode="reflections"
        activeReflectionId={selectedId}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:h-full tw:bg-bg-3 tw:relative tw:overflow-hidden">
        <div className={`tw:flex-1 tw:min-h-0 tw:overflow-y-auto ${selected ? "tw:p-5" : "tw:pt-8 tw:px-10 tw:pb-20"} tw:bg-bg-3 tw:dark:[background:radial-gradient(800px_400px_at_100%_-10%,color-mix(in_oklab,var(--lilac)_6%,transparent),transparent_60%),var(--bg-3)]`}>
          {/* The sidebar is the list + search; the page is the reader and
              gets ALL the space — the card spans the column and stretches
              to full height. The hero only shows when there's nothing to
              read. */}
          {selected ? (
            <ReflectionDetail
              key={selected._id}
              reflection={selected}
              chatTitle={chatTitleById.get(selected.chatId) ?? "(deleted chat)"}
              onOpenBranch={() => navigate(`/chat/${selected.chatId}?node=${selected.nodeId}`)}
              onAddToGraph={() => setGraphTarget({ type: "reflection", id: selected._id, title: selected.title })}
              onDeleted={() => { setSelectedId(null); toast("Reflection deleted", { kind: "success" }); }}
            />
          ) : (
            <div className="tw:max-w-[920px] tw:mx-auto">
              <div className="tw:mt-0 tw:mb-7">
                <span className="tw:font-mono tw:text-[10px] tw:tracking-[0.14em] tw:uppercase tw:text-ink-3 tw:inline-flex tw:items-center tw:gap-2">
                  <span className="tw:w-1.5 tw:h-1.5 tw:rounded-[50%] tw:bg-lilac" />
                  Reflections
                </span>
                <h1 className="tw:font-display tw:font-semibold tw:text-[44px] tw:tracking-[-0.025em] tw:my-2 tw:mx-0 tw:leading-none">
                  Your <em className="tw:font-serif tw:italic tw:text-lilac tw:font-normal">reflections</em>.
                </h1>
                <p className="tw:text-ink-2 tw:m-0 tw:max-w-[560px] tw:text-[16px]">
                  Distilled snapshots of branches worth keeping. Save one from any
                  chat with ⌃R → "Save as reflection".
                </p>
              </div>
              <div className="tw:border tw:border-dashed tw:border-line tw:rounded-[16px] tw:py-12 tw:px-8 tw:text-center tw:text-ink-3 tw:text-[14px]">
                No reflections yet. Open a chat, press <kbd className="tw:font-mono tw:text-[11px] tw:bg-bg-2 tw:border tw:border-line tw:py-0.5 tw:px-1.5 tw:rounded-[5px] tw:text-ink">⌃R</kbd> to
                enter reflections mode, tidy the path, then choose <span className="tw:text-ink">Save as reflection</span>.
              </div>
            </div>
          )}
        </div>
      </div>
      <AddToGraphDialog
        open={graphTarget !== null}
        target={graphTarget}
        onClose={() => setGraphTarget(null)}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// ── detail pane ───────────────────────────────────────────────────────────

interface ReflectionDetailProps {
  reflection:   Reflection;
  chatTitle:    string;
  onOpenBranch: () => void;
  onAddToGraph: () => void;
  onDeleted:    () => void;
}

function ReflectionDetail({ reflection, chatTitle, onOpenBranch, onAddToGraph, onDeleted }: ReflectionDetailProps) {
  const toast = useToast();
  const [editing, setEditing]       = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Title rename, mirroring the sidebar's inline-edit pattern (Enter
  // commits, Esc cancels, the ref guards Enter-then-blur double commit).
  const [renaming, setRenaming]     = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const committedRef = useRef(false);

  // Delete confirm auto-reverts after 4s — same as every confirm pill.
  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const startRename = (): void => {
    committedRef.current = false;
    setTitleDraft(reflection.title);
    setRenaming(true);
  };

  const commitRename = async (): Promise<void> => {
    if (committedRef.current) return;
    committedRef.current = true;
    setRenaming(false);
    const t = titleDraft.trim();
    if (!t || t === reflection.title) return;
    try {
      await db.reflections.update(reflection._id, { title: t, updatedAt: Date.now() });
    } catch (err) {
      toast(`Couldn't rename: ${(err as Error).message}`, { kind: "error" });
    }
  };

  const handleSaveBody = async (markdown: string): Promise<void> => {
    const next = markdown.replace(/\s+$/g, "");
    setEditing(false);
    if (next === reflection.body) return;
    try {
      await db.reflections.update(reflection._id, { body: next, updatedAt: Date.now() });
      toast("Reflection updated", { kind: "success" });
    } catch (err) {
      toast(`Couldn't save: ${(err as Error).message}`, { kind: "error" });
    }
  };

  const handleDelete = async (): Promise<void> => {
    setConfirming(false);
    try {
      await deleteReflection(reflection._id);   // also drops knowledge-graph links
      onDeleted();
    } catch (err) {
      toast(`Couldn't delete: ${(err as Error).message}`, { kind: "error" });
    }
  };

  return (
    <div className="tw:bg-bg tw:border tw:border-line tw:rounded-[16px] tw:py-6 tw:px-8 tw:min-w-0 tw:min-h-full">
      <div className="tw:flex tw:items-start tw:gap-2.5 tw:mb-1">
        {renaming ? (
          <input
            className="tw:flex-1 tw:min-w-0 tw:font-display tw:font-semibold tw:text-[22px] tw:tracking-[-0.015em] tw:text-ink tw:bg-bg-3 tw:border tw:border-line tw:rounded-[7px] tw:px-2 tw:py-1 tw:outline-none tw:focus:border-lilac"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            autoFocus
            onFocus={e => e.currentTarget.select()}
            onKeyDown={e => {
              if (e.key === "Enter")  { e.preventDefault(); void commitRename(); }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); committedRef.current = true; setRenaming(false); }
            }}
            onBlur={() => void commitRename()}
          />
        ) : (
          <h2 className="tw:flex-1 tw:min-w-0 tw:m-0 tw:font-display tw:font-semibold tw:text-[22px] tw:tracking-[-0.015em] tw:text-ink tw:leading-[1.2] tw:text-balance">
            {reflection.title || "Untitled reflection"}
          </h2>
        )}

        <div className="tw:flex tw:items-center tw:gap-1 tw:flex-none tw:pt-0.5">
          <button
            className="tw:w-[28px] tw:h-[28px] tw:grid tw:place-items-center tw:rounded-[7px] tw:text-ink-3 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-teal-tint tw:hover:text-teal"
            title="Add to knowledge graph"
            aria-label="Add to knowledge graph"
            onClick={onAddToGraph}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="4" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="12.5" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="6.5" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5.6 5 L11 6 M5 5.7 L6.2 10.8 M7.9 11.7 L11.3 7.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="tw:w-[28px] tw:h-[28px] tw:grid tw:place-items-center tw:rounded-[7px] tw:text-ink-3 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-[color-mix(in_oklab,var(--lilac)_18%,transparent)] tw:hover:text-lilac"
            title="Rename"
            aria-label="Rename reflection"
            onClick={startRename}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M11 2.5 L13.5 5 M10 3.5 L3.5 10 L3 13 L6 12.5 L12.5 6"
                    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className="tw:w-[28px] tw:h-[28px] tw:grid tw:place-items-center tw:rounded-[7px] tw:text-ink-3 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink"
            title={editing ? "Close editor" : "Edit body"}
            aria-label="Edit reflection body"
            onClick={() => setEditing(v => !v)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 11 L3 13 L5 13 L13 5 L11 3 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className="tw:w-[28px] tw:h-[28px] tw:grid tw:place-items-center tw:rounded-[7px] tw:text-ink-3 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-[color-mix(in_oklab,var(--coral)_18%,transparent)] tw:hover:text-coral"
            title="Delete reflection"
            aria-label="Delete reflection"
            onClick={() => setConfirming(true)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 4 H13 M6 4 V3 a1 1 0 0 1 1 -1 h2 a1 1 0 0 1 1 1 V4 M5 4 v9 a1 1 0 0 0 1 1 h4 a1 1 0 0 0 1 -1 V4"
                    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 7 V11 M9 7 V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="tw:font-mono tw:text-[11px] tw:text-ink-3 tw:mb-4 tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
        <span className="tw:truncate tw:max-w-[280px]">{chatTitle}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{relativeTime(reflection.updatedAt)}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <button
          className="tw:text-lilac tw:hover:underline tw:p-0"
          onClick={onOpenBranch}
          title="Jump to the branch this reflection was saved from"
        >
          Open source branch →
        </button>
      </div>

      {confirming && (
        <div className="tw:flex tw:items-center tw:gap-1.5 tw:mb-3 tw:px-2.5 tw:py-1.5 tw:bg-[color-mix(in_oklab,var(--coral)_12%,var(--bg-3))] tw:border tw:border-[color-mix(in_oklab,var(--coral)_30%,var(--line))] tw:rounded-[8px] tw:text-[12px] tw:text-ink">
          <span className="tw:flex-1 tw:min-w-0">Delete this reflection?</span>
          <button
            className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:transition-[background-color,color] tw:duration-100 tw:ease-[ease] tw:text-coral tw:font-semibold tw:hover:bg-coral tw:hover:text-white"
            onClick={() => void handleDelete()}
          >
            yes
          </button>
          <span className="tw:text-ink-4">·</span>
          <button
            className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:transition-[background-color,color] tw:duration-100 tw:ease-[ease] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink"
            onClick={() => setConfirming(false)}
          >
            cancel
          </button>
        </div>
      )}

      <div className="m-body">
        {editing ? (
          <Suspense fallback={<div className="rte-shell rte-loading">Loading editor…</div>}>
            <RichEditor
              initial={reflection.body}
              onSave={(md: string) => void handleSaveBody(md)}
              onCancel={() => setEditing(false)}
              variant="default"
            />
          </Suspense>
        ) : (
          <MarkdownBody text={reflection.body} />
        )}
      </div>
    </div>
  );
}
