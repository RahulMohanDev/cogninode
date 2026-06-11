// src/pages/Graphs.tsx
// Knowledge-graph list: cards with a tiny constellation preview of each
// graph's nodes (root drawn bigger, in coral), plus create / rename /
// delete. Creation is name-first — the name becomes the root node, the
// anchor retrieval starts from. Mirrors the Chats "grove" page.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type GraphEdge, type GraphNode, type KnowledgeGraph } from "../lib/db";
import { deleteGraph, renameGraph } from "../lib/knowledge";
import { NewGraphDialog } from "../components/graph/NewGraphDialog";
import { Sidebar } from "../components/chat/Sidebar";
import { SettingsModal } from "../components/settings/SettingsModal";
import { useSettings } from "../hooks/useSettings";
import { useSettingsHotkey } from "../hooks/useSettingsHotkey";

function relativeTime(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1)  return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7)    return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Graphs() {
  const navigate = useNavigate();
  const { prefs } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  useSettingsHotkey(() => setSettingsOpen(true));

  const graphs = useLiveQuery(
    () => db.graphs.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const nodes = useLiveQuery(() => db.graphNodes.toArray(), [], [] as GraphNode[]);
  const edges = useLiveQuery(() => db.graphEdges.toArray(), [], [] as GraphEdge[]);

  const byGraph = useMemo(() => {
    const map = new Map<string, { nodes: GraphNode[]; edges: GraphEdge[] }>();
    const entry = (id: string) => {
      const e = map.get(id) ?? { nodes: [], edges: [] };
      map.set(id, e);
      return e;
    };
    for (const n of nodes) entry(n.graphId).nodes.push(n);
    for (const ed of edges) entry(ed.graphId).edges.push(ed);
    return map;
  }, [nodes, edges]);

  return (
    <div className={`tw:grid tw:h-dvh tw:w-screen tw:transition-[grid-template-columns] tw:duration-[220ms] tw:ease-[cubic-bezier(0.4,0,0.2,1)] tw:motion-reduce:transition-none ${prefs.sidebarCollapsed ? "tw:grid-cols-[60px_1fr]" : "tw:grid-cols-[268px_1fr]"}`}>
      <Sidebar activeChatId={null} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:h-full tw:bg-bg-3 tw:relative tw:overflow-hidden">
        <div className="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:pt-8 tw:px-10 tw:pb-20 tw:bg-bg-3 tw:dark:[background:radial-gradient(800px_400px_at_100%_-10%,color-mix(in_oklab,var(--teal)_6%,transparent),transparent_60%),var(--bg-3)]">
          <div className="tw:max-w-[880px] tw:mx-auto tw:mt-0 tw:mb-9">
            <span className="tw:font-mono tw:text-[10px] tw:tracking-[0.14em] tw:uppercase tw:text-ink-3 tw:inline-flex tw:items-center tw:gap-2">
              <span className="tw:w-1.5 tw:h-1.5 tw:rounded-[50%] tw:bg-teal" />
              Knowledge graphs
            </span>
            <h1 className="tw:font-display tw:font-semibold tw:text-[44px] tw:tracking-[-0.025em] tw:my-2 tw:mx-0 tw:leading-none">
              Your <em className="tw:font-serif tw:italic tw:text-teal tw:font-normal">map</em>.
            </h1>
            <p className="tw:text-ink-2 tw:m-0 tw:max-w-[560px] tw:text-[16px]">
              Each graph is a topic anchored by a root — drag the chats
              behind it in, wire them up, then ask the graph questions.
              Hand-built retrieval, your way.
            </p>
          </div>

          <div className="tw:max-w-[880px] tw:mx-auto">
            <div className="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] tw:gap-4">
              <div
                className="tw:border tw:border-line tw:rounded-[16px] tw:p-[18px] tw:cursor-pointer tw:transition-[border-color,transform] tw:duration-[120ms] tw:ease-[ease] tw:min-h-[160px] tw:relative tw:overflow-hidden tw:bg-bg-3 tw:border-dashed tw:grid tw:place-items-center tw:text-center tw:hover:border-ink-3 tw:hover:-translate-y-0.5"
                onClick={() => setCreating(true)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setCreating(true);
                  }
                }}
              >
                <div>
                  <div className="tw:w-11 tw:h-11 tw:grid tw:place-items-center tw:rounded-[50%] tw:bg-teal tw:text-white tw:text-[22px] tw:font-light tw:leading-none tw:mb-3 tw:mx-auto">+</div>
                  <div className="tw:font-display tw:font-semibold tw:text-[16px] tw:tracking-[-0.01em]">New graph</div>
                  <div className="tw:text-[12px] tw:text-ink-3 tw:mt-1">name a topic — get its root</div>
                </div>
              </div>

              {graphs?.map(g => (
                <GraphCard
                  key={g._id}
                  graph={g}
                  nodes={byGraph.get(g._id)?.nodes ?? []}
                  edges={byGraph.get(g._id)?.edges ?? []}
                  onOpen={() => navigate(`/graphs/${g._id}`)}
                />
              ))}

              {graphs && graphs.length === 0 && (
                <div className="tw:col-span-full tw:text-ink-3 tw:text-[13px] tw:px-1 tw:py-3">
                  No graphs yet. Create one, drag in the chats where you
                  learned the topic, and ask it questions.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <NewGraphDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={id => { setCreating(false); navigate(`/graphs/${id}`); }}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// ── per-graph card ─────────────────────────────────────────────────────

function GraphCard({
  graph, nodes, edges, onOpen,
}: {
  graph: KnowledgeGraph;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onOpen: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming]     = useState(false);
  const [draft, setDraft]           = useState("");
  const committedRef = useRef(false);
  const revertRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (revertRef.current !== null) window.clearTimeout(revertRef.current);
  }, []);

  const arm = (): void => {
    setConfirming(true);
    if (revertRef.current !== null) window.clearTimeout(revertRef.current);
    revertRef.current = window.setTimeout(() => setConfirming(false), 4000);
  };

  const commitRename = (): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    setRenaming(false);
    void renameGraph(graph._id, draft);
  };

  const attached = nodes.filter(n => n.attachment).length;

  return (
    <div
      className="tw:group/card tw:bg-bg tw:border tw:border-line tw:rounded-[16px] tw:p-[18px] tw:cursor-pointer tw:transition-[border-color,transform] tw:duration-[120ms] tw:ease-[ease] tw:min-h-[160px] tw:relative tw:overflow-hidden tw:flex tw:flex-col tw:hover:border-ink-3 tw:hover:-translate-y-0.5"
      onClick={() => { if (!renaming) onOpen(); }}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if ((e.key === "Enter" || e.key === " ") && !renaming) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="tw:absolute tw:top-2.5 tw:right-2.5 tw:flex tw:gap-1">
        <button
          className="tw:w-6 tw:h-6 tw:grid tw:place-items-center tw:rounded-[6px] tw:text-ink-3 tw:opacity-0 tw:transition-[opacity,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:group-hover/card:opacity-90 tw:hover:bg-[color-mix(in_oklab,var(--lilac)_18%,transparent)] tw:hover:text-lilac"
          title="Rename graph"
          aria-label="Rename graph"
          onClick={e => { e.stopPropagation(); committedRef.current = false; setDraft(graph.name); setRenaming(true); }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M11 2.5 L13.5 5 M10 3.5 L3.5 10 L3 13 L6 12.5 L12.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="tw:w-6 tw:h-6 tw:grid tw:place-items-center tw:rounded-[6px] tw:text-ink-3 tw:opacity-0 tw:transition-[opacity,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:group-hover/card:opacity-90 tw:hover:bg-[color-mix(in_oklab,var(--coral)_18%,transparent)] tw:hover:text-coral"
          title="Delete graph"
          aria-label="Delete graph"
          onClick={e => { e.stopPropagation(); arm(); }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 4 H13 M6 4 V3 a1 1 0 0 1 1 -1 h2 a1 1 0 0 1 1 1 V4 M5 4 v9 a1 1 0 0 0 1 1 h4 a1 1 0 0 0 1 -1 V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {renaming ? (
        <input
          className="tw:font-display tw:font-semibold tw:text-[19px] tw:tracking-[-0.015em] tw:text-ink tw:bg-bg-3 tw:border tw:border-line tw:rounded-[7px] tw:px-2 tw:py-1 tw:outline-none tw:focus:border-lilac tw:mb-2"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
          onFocus={e => e.currentTarget.select()}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); committedRef.current = true; setRenaming(false); }
          }}
          onBlur={commitRename}
        />
      ) : (
        <div className="tw:font-display tw:font-semibold tw:text-[19px] tw:tracking-[-0.015em] tw:leading-[1.15] tw:mb-2 tw:text-balance tw:pr-12">{graph.name}</div>
      )}

      <div className="tw:font-mono tw:text-[11px] tw:text-ink-3 tw:mb-4 tw:flex tw:items-center tw:gap-2.5">
        <span>{nodes.length} node{nodes.length === 1 ? "" : "s"}</span>
        {attached > 0 && (
          <>
            <span style={{ opacity: 0.3 }}>·</span>
            <span>{attached} attached</span>
          </>
        )}
        <span style={{ opacity: 0.3 }}>·</span>
        <span>{relativeTime(graph.updatedAt)}</span>
      </div>

      <div className="tw:flex-1 tw:relative tw:mt-auto">
        <MiniConstellation nodes={nodes} edges={edges} />
      </div>

      {confirming && (
        <div
          className="tw:absolute tw:[inset:auto_10px_10px_10px] tw:flex tw:items-center tw:gap-1.5 tw:px-2.5 tw:py-[7px] tw:bg-[color-mix(in_oklab,var(--coral)_14%,var(--bg-3))] tw:border tw:border-[color-mix(in_oklab,var(--coral)_30%,var(--line))] tw:rounded-[8px] tw:text-[12px] tw:text-ink tw:shadow-1"
          onClick={e => e.stopPropagation()}
        >
          <span className="tw:flex-1 tw:min-w-0">Delete this graph?</span>
          <button className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:text-coral tw:font-semibold tw:hover:bg-coral tw:hover:text-white" onClick={() => void deleteGraph(graph._id)}>yes</button>
          <span className="tw:text-ink-4">·</span>
          <button className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink" onClick={() => setConfirming(false)}>cancel</button>
        </div>
      )}
    </div>
  );
}

// ── tiny constellation preview ─────────────────────────────────────────

const THUMB_W = 120;
const THUMB_H = 52;
const PAD = 8;
const ACCENT_VAR: Record<string, string> = {
  coral: "var(--coral)", teal: "var(--teal)", lilac: "var(--lilac)", butter: "var(--butter)",
};

function MiniConstellation({
  nodes, edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const points = nodes.map(n => ({
    id:   n._id,
    x:    n.x,
    y:    n.y,
    fill: n.kind === "root"
      ? "var(--coral)"
      : n.attachment ? "var(--ink-3)" : (ACCENT_VAR[n.color] ?? "var(--ink-3)"),
    r:    n.kind === "root" ? 3.4 : n.attachment ? 1.9 : 2.6,
  }));
  if (points.length === 0) {
    return <svg width={THUMB_W} height={THUMB_H} aria-hidden="true" />;
  }
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const project = (x: number, y: number) => ({
    px: maxX > minX ? PAD + ((x - minX) / (maxX - minX)) * (THUMB_W - PAD * 2) : THUMB_W / 2,
    py: maxY > minY ? PAD + ((y - minY) / (maxY - minY)) * (THUMB_H - PAD * 2) : THUMB_H / 2,
  });
  const posById = new Map(points.map(p => [p.id, project(p.x, p.y)]));
  const visible = points.slice(0, 32);

  return (
    <svg width={THUMB_W} height={THUMB_H} viewBox={`0 0 ${THUMB_W} ${THUMB_H}`} aria-hidden="true" style={{ display: "block" }}>
      {edges.map(e => {
        const a = posById.get(e.source);
        const b = posById.get(e.target);
        if (!a || !b) return null;
        return <line key={e._id} x1={a.px} y1={a.py} x2={b.px} y2={b.py} style={{ stroke: "var(--line)" }} strokeWidth={1} />;
      })}
      {visible.map(p => {
        const pos = posById.get(p.id)!;
        return <circle key={p.id} cx={pos.px} cy={pos.py} r={p.r} style={{ fill: p.fill }} />;
      })}
    </svg>
  );
}
