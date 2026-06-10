// src/pages/GraphEditor.tsx
// The knowledge-graph editor: a React Flow canvas of concept cards the
// user creates (double-click), drags (positions persist), connects
// (drag handle to handle), and deletes (Backspace) — plus a side panel
// for the selected concept: rename, color, notes, and the chats /
// reflections attached to it. Everything writes straight to Dexie;
// liveQuery keeps the canvas in sync.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge as FlowEdge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  db,
  type Chat, type Concept, type ConceptEdge, type ConceptLink, type Reflection,
} from "../lib/db";
import {
  CONCEPT_COLORS,
  addConceptEdge, attachToConcept, createConcept, deleteConcept,
  deleteConceptEdge, detachLink, moveConcept, renameGraph, updateConcept,
} from "../lib/knowledge";
import { buildConceptFlowGraph, type ConceptNodeData } from "../lib/flowGraph";
import { ConceptNode, type ConceptFlowNode } from "../components/graph/ConceptNode";
import { miniMapStyle, useFlowTheme } from "../components/graph/flowTheme";
import { Sidebar } from "../components/chat/Sidebar";
import { SettingsModal } from "../components/settings/SettingsModal";
import { useSettings } from "../hooks/useSettings";
import { useSettingsHotkey } from "../hooks/useSettingsHotkey";
import { useToast } from "../components/ui/Toast";

const nodeTypes = { concept: ConceptNode };

const COLOR_BG: Record<string, string> = {
  coral: "tw:bg-coral", teal: "tw:bg-teal", lilac: "tw:bg-lilac", butter: "tw:bg-butter",
};

export default function GraphEditor() {
  const { graphId = "" } = useParams<{ graphId: string }>();
  const navigate = useNavigate();
  const { prefs } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useSettingsHotkey(() => setSettingsOpen(true));

  const [searchParams] = useSearchParams();
  const focusConceptId = searchParams.get("concept");

  const graph = useLiveQuery(
    () => (graphId ? db.graphs.get(graphId) : undefined),
    [graphId],
  );
  const concepts = useLiveQuery(
    () => db.concepts.where("graphId").equals(graphId).toArray(),
    [graphId], [] as Concept[],
  );
  const conceptEdges = useLiveQuery(
    () => db.conceptEdges.where("graphId").equals(graphId).toArray(),
    [graphId], [],
  );
  const links = useLiveQuery(
    () => db.conceptLinks.where("graphId").equals(graphId).toArray(),
    [graphId], [] as ConceptLink[],
  );
  const chats = useLiveQuery(() => db.chats.toArray(), [], [] as Chat[]);
  const reflections = useLiveQuery(() => db.reflections.toArray(), [], [] as Reflection[]);

  const [selectedId, setSelectedId] = useState<string | null>(focusConceptId);
  const selected = useMemo(
    () => concepts.find(c => c._id === selectedId) ?? null,
    [concepts, selectedId],
  );
  const selectedLinks = useMemo(
    () => links.filter(l => l.conceptId === selectedId),
    [links, selectedId],
  );

  // "Not found" grace, mirroring Chat.tsx.
  const [tookTooLong, setTookTooLong] = useState(false);
  useEffect(() => {
    setTookTooLong(false);
    const t = setTimeout(() => setTookTooLong(true), 250);
    return () => clearTimeout(t);
  }, [graphId]);

  // Inline graph rename.
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const committedRef = useRef(false);
  const commitName = (): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    setRenaming(false);
    void renameGraph(graphId, nameDraft);
  };

  if (graph === undefined && tookTooLong) {
    return (
      <div className="tw:h-dvh tw:grid tw:place-items-center tw:text-ink-3">
        <div className="tw:text-center">
          <h2 className="tw:font-display tw:font-semibold tw:text-[34px] tw:tracking-[-0.025em] tw:text-ink tw:m-0 tw:mb-3">Graph <em className="tw:font-serif tw:italic tw:text-coral tw:font-normal">not found</em>.</h2>
          <p className="tw:text-[15px] tw:text-ink-2"><Link to="/graphs" style={{ color: "var(--coral)", textDecoration: "underline" }}>Back to all graphs →</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className={`tw:grid tw:h-dvh tw:w-screen tw:transition-[grid-template-columns] tw:duration-[220ms] tw:ease-[cubic-bezier(0.4,0,0.2,1)] tw:motion-reduce:transition-none ${prefs.sidebarCollapsed ? "tw:grid-cols-[60px_1fr]" : "tw:grid-cols-[268px_1fr]"}`}>
      <Sidebar activeChatId={null} onOpenSettings={() => setSettingsOpen(true)} />

      <div className="tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:h-full tw:bg-bg-3 tw:relative tw:overflow-hidden">
        <div className="tw:flex tw:items-center tw:gap-3 tw:py-3 tw:px-[22px] tw:border-b tw:border-line tw:bg-bg-3 tw:min-h-[58px]">
          <button
            className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink"
            onClick={() => navigate("/graphs")}
            title="All graphs"
            aria-label="All graphs"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {renaming ? (
            <input
              className="tw:flex-1 tw:min-w-0 tw:font-display tw:font-semibold tw:text-[17px] tw:tracking-[-0.015em] tw:text-ink tw:bg-bg tw:border tw:border-line tw:rounded-[7px] tw:px-2 tw:py-1 tw:outline-none tw:focus:border-lilac"
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              autoFocus
              onFocus={e => e.currentTarget.select()}
              onKeyDown={e => {
                if (e.key === "Enter")  { e.preventDefault(); commitName(); }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); committedRef.current = true; setRenaming(false); }
              }}
              onBlur={commitName}
            />
          ) : (
            <button
              className="tw:flex-1 tw:min-w-0 tw:text-left tw:font-display tw:font-semibold tw:text-[17px] tw:tracking-[-0.015em] tw:text-ink tw:truncate tw:p-0 tw:hover:text-coral"
              onClick={() => { committedRef.current = false; setNameDraft(graph?.name ?? ""); setRenaming(true); }}
              title="Rename graph"
            >
              {graph?.name ?? "…"}
            </button>
          )}

          <span className="tw:font-mono tw:text-[11px] tw:text-ink-3 tw:tracking-[0.06em] tw:uppercase tw:flex-none">
            {concepts.length} concept{concepts.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="tw:flex-1 tw:flex tw:min-h-0">
          <div className="tw:flex-1 tw:relative tw:min-w-0">
            <ReactFlowProvider>
              <ConceptCanvas
                graphId={graphId}
                concepts={concepts}
                conceptEdges={conceptEdges}
                links={links}
                selectedId={selectedId}
                onSelect={setSelectedId}
                focusConceptId={focusConceptId}
              />
            </ReactFlowProvider>
          </div>

          {selected && (
            <ConceptPanel
              key={selected._id}
              graphId={graphId}
              concept={selected}
              links={selectedLinks}
              chats={chats}
              reflections={reflections}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// ── canvas ─────────────────────────────────────────────────────────────

interface ConceptCanvasProps {
  graphId:        string;
  concepts:       Concept[];
  conceptEdges:   ConceptEdge[];
  links:          ConceptLink[];
  selectedId:     string | null;
  onSelect:       (id: string | null) => void;
  focusConceptId: string | null;
}

function ConceptCanvas({
  graphId, concepts, conceptEdges, links, selectedId, onSelect, focusConceptId,
}: ConceptCanvasProps) {
  const { prefs } = useSettings();
  const flow = useReactFlow();
  const mini = useFlowTheme(prefs.theme);

  const graphData = useMemo(
    () => buildConceptFlowGraph(concepts, conceptEdges, links),
    [concepts, conceptEdges, links],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(graphData.nodes as ConceptFlowNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphData.edges as FlowEdge[]);

  // Re-sync from Dexie — but never mid-drag, or the dragged card would
  // snap back to its last persisted position.
  const draggingRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current) return;
    setNodes(
      (graphData.nodes as ConceptFlowNode[]).map(n =>
        n.id === selectedId ? { ...n, selected: true } : n),
    );
  }, [graphData.nodes, selectedId, setNodes]);
  useEffect(() => { setEdges(graphData.edges as FlowEdge[]); }, [graphData.edges, setEdges]);

  // ?concept= deep link (from ⌘K): select + center once.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (focusedRef.current || !focusConceptId) return;
    const c = concepts.find(x => x._id === focusConceptId);
    if (!c) return;
    focusedRef.current = true;
    onSelect(c._id);
    setTimeout(() => flow.setCenter(c.x + 100, c.y + 40, { zoom: 1, duration: 500 }), 120);
  }, [focusConceptId, concepts, flow, onSelect]);

  const addAtScreen = useCallback(async (clientX: number, clientY: number) => {
    const pos = flow.screenToFlowPosition({ x: clientX, y: clientY });
    const id = await createConcept(graphId, { x: pos.x - 100, y: pos.y - 30 });
    onSelect(id);
  }, [flow, graphId, onSelect]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) void addConceptEdge(graphId, c.source, c.target);
  }, [graphId]);

  return (
    <div
      className="tw:absolute tw:inset-0"
      onDoubleClick={e => {
        const t = e.target as HTMLElement;
        if (!t.closest(".react-flow__pane")) return;
        void addAtScreen(e.clientX, e.clientY);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        colorMode={prefs.theme}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        zoomOnDoubleClick={false}
        deleteKeyCode={["Backspace", "Delete"]}
        onConnect={onConnect}
        onNodeClick={(_e, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStart={() => { draggingRef.current = true; }}
        onNodeDragStop={(_e, node, draggedNodes) => {
          draggingRef.current = false;
          const moved = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node];
          for (const n of moved) void moveConcept(n.id, n.position.x, n.position.y);
        }}
        onNodesDelete={deleted => {
          for (const n of deleted) void deleteConcept(n.id);
          onSelect(null);
        }}
        onEdgesDelete={deleted => {
          for (const e of deleted) void deleteConceptEdge(e.id);
        }}
        connectionLineStyle={{ stroke: "var(--lilac)", strokeWidth: 2 }}
        style={{ background: "transparent" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} color="var(--line)" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={n => mini.accents[(n.data as ConceptNodeData).color] ?? mini.stroke}
          nodeStrokeWidth={3}
          nodeBorderRadius={4}
          maskColor={mini.mask}
          style={miniMapStyle(mini)}
        />
        <Panel position="top-left">
          <button
            className="tw:bg-bg-3 tw:text-ink tw:py-2 tw:px-3.5 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:shadow-1 tw:inline-flex tw:items-center tw:gap-1.5 tw:hover:border-ink-3"
            onClick={() => {
              const el = document.querySelector(".react-flow__pane");
              const r = el?.getBoundingClientRect();
              void addAtScreen(r ? r.left + r.width / 2 : window.innerWidth / 2, r ? r.top + r.height / 2 : window.innerHeight / 2);
            }}
          >
            + Concept
          </button>
        </Panel>
        {concepts.length === 0 && (
          <Panel position="top-center">
            <div className="tw:mt-16 tw:py-2.5 tw:px-4 tw:rounded-[999px] tw:bg-bg-2 tw:border tw:border-line tw:text-[13px] tw:text-ink-2 tw:shadow-1">
              Double-click anywhere to add your first concept.
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

// ── side panel ─────────────────────────────────────────────────────────

interface ConceptPanelProps {
  graphId:     string;
  concept:     Concept;
  links:       ConceptLink[];
  chats:       Chat[];
  reflections: Reflection[];
  onClose:     () => void;
}

function ConceptPanel({ graphId, concept, links, chats, reflections, onClose }: ConceptPanelProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [label, setLabel] = useState(concept.label);
  const [notes, setNotes] = useState(concept.notes);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const chatById = useMemo(() => new Map(chats.map(c => [c._id, c])), [chats]);
  const refById  = useMemo(() => new Map(reflections.map(r => [r._id, r])), [reflections]);

  const chatLinks = links.filter(l => l.targetType === "chat");
  const refLinks  = links.filter(l => l.targetType === "reflection");
  const linkedIds = useMemo(() => new Set(links.map(l => l.targetId)), [links]);

  const attach = (targetType: "chat" | "reflection") => (targetId: string): void => {
    void attachToConcept({ graphId, conceptId: concept._id, targetType, targetId })
      .catch(err => toast(`Couldn't attach: ${(err as Error).message}`, { kind: "error" }));
  };

  return (
    <div className="tw:w-[320px] tw:flex-none tw:border-l tw:border-line tw:bg-bg tw:flex tw:flex-col tw:overflow-y-auto tw:[scrollbar-width:thin] tw:[scrollbar-color:var(--line)_transparent]">
      <div className="tw:flex tw:items-center tw:gap-2 tw:py-3 tw:px-4 tw:border-b tw:border-line">
        <span className="tw:font-mono tw:text-[10px] tw:tracking-[0.14em] tw:uppercase tw:text-ink-3 tw:flex-1">Concept</span>
        <button
          className="tw:w-[26px] tw:h-[26px] tw:grid tw:place-items-center tw:rounded-[7px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink"
          onClick={onClose}
          title="Close panel"
          aria-label="Close panel"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="tw:p-4 tw:flex tw:flex-col tw:gap-4">
        <div className="tw:flex tw:flex-col tw:gap-1">
          <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">Name</label>
          <input
            className="tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:outline-none tw:bg-bg-3 tw:text-ink tw:focus:border-lilac"
            value={label}
            onChange={e => setLabel(e.target.value)}
            onBlur={() => { if (label.trim() && label !== concept.label) void updateConcept(concept._id, { label: label.trim() }); }}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            spellCheck={false}
          />
        </div>

        <div className="tw:flex tw:flex-col tw:gap-1.5">
          <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">Color</label>
          <div className="tw:flex tw:gap-2">
            {CONCEPT_COLORS.map(c => (
              <button
                key={c}
                className={`tw:w-[26px] tw:h-[26px] tw:rounded-[50%] ${COLOR_BG[c]} ${concept.color === c ? "tw:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_30%,transparent)]" : "tw:opacity-75 tw:hover:opacity-100"}`}
                onClick={() => void updateConcept(concept._id, { color: c })}
                title={c}
                aria-label={`Color ${c}`}
                aria-pressed={concept.color === c}
              />
            ))}
          </div>
        </div>

        <div className="tw:flex tw:flex-col tw:gap-1">
          <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">Notes</label>
          <textarea
            className="tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[13px] tw:leading-[1.5] tw:outline-none tw:bg-bg-3 tw:text-ink tw:focus:border-lilac tw:resize-y tw:min-h-[72px]"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => { if (notes !== concept.notes) void updateConcept(concept._id, { notes }); }}
            placeholder="What is this concept about?"
            rows={3}
          />
        </div>

        <AttachSection
          title="Chats"
          rows={chatLinks.map(l => ({
            link: l,
            title: chatById.get(l.targetId)?.title ?? "(deleted chat)",
            open: () => navigate(`/chat/${l.targetId}`),
          }))}
          pickerItems={chats
            .filter(c => !linkedIds.has(c._id))
            .map(c => ({ id: c._id, title: c.title || "Untitled chat" }))}
          pickerPlaceholder="Attach a chat…"
          onPick={attach("chat")}
        />

        <AttachSection
          title="Reflections"
          rows={refLinks.map(l => ({
            link: l,
            title: refById.get(l.targetId)?.title ?? "(deleted reflection)",
            open: () => navigate(`/reflections?open=${l.targetId}`),
          }))}
          pickerItems={reflections
            .filter(r => !linkedIds.has(r._id))
            .map(r => ({ id: r._id, title: r.title || "Untitled reflection" }))}
          pickerPlaceholder="Attach a reflection…"
          onPick={attach("reflection")}
        />

        <div className="tw:pt-2 tw:border-t tw:border-line-2">
          {confirming ? (
            <div className="tw:flex tw:items-center tw:gap-1.5 tw:px-2.5 tw:py-1.5 tw:bg-[color-mix(in_oklab,var(--coral)_12%,var(--bg-3))] tw:border tw:border-[color-mix(in_oklab,var(--coral)_30%,var(--line))] tw:rounded-[8px] tw:text-[12px] tw:text-ink">
              <span className="tw:flex-1">Delete this concept?</span>
              <button className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:text-coral tw:font-semibold tw:hover:bg-coral tw:hover:text-white" onClick={() => { void deleteConcept(concept._id); onClose(); }}>yes</button>
              <span className="tw:text-ink-4">·</span>
              <button className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink" onClick={() => setConfirming(false)}>cancel</button>
            </div>
          ) : (
            <button
              className="tw:w-full tw:py-2 tw:px-3 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-coral tw:text-coral tw:bg-bg tw:hover:bg-coral-tint"
              onClick={() => setConfirming(true)}
            >
              Delete concept
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── attach widgets ─────────────────────────────────────────────────────

interface AttachRow {
  link:  ConceptLink;
  title: string;
  open:  () => void;
}

function AttachSection({
  title, rows, pickerItems, pickerPlaceholder, onPick,
}: {
  title:             string;
  rows:              AttachRow[];
  pickerItems:       Array<{ id: string; title: string }>;
  pickerPlaceholder: string;
  onPick:            (id: string) => void;
}) {
  return (
    <div className="tw:flex tw:flex-col tw:gap-1.5">
      <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">
        {title}{rows.length > 0 ? ` · ${rows.length}` : ""}
      </label>
      {rows.map(({ link, title: rowTitle, open }) => (
        <div key={link._id} className="tw:group/att tw:flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-2 tw:rounded-[8px] tw:border tw:border-line-2 tw:bg-bg-3 tw:text-[12.5px] tw:text-ink tw:min-w-0">
          <button className="tw:flex-1 tw:min-w-0 tw:truncate tw:text-left tw:p-0 tw:hover:text-coral" onClick={open} title={`Open: ${rowTitle}`}>
            {rowTitle}
          </button>
          <button
            className="tw:w-[20px] tw:h-[20px] tw:grid tw:place-items-center tw:rounded-[5px] tw:flex-none tw:text-ink-4 tw:opacity-0 tw:group-hover/att:opacity-100 tw:hover:bg-[color-mix(in_oklab,var(--coral)_18%,transparent)] tw:hover:text-coral"
            onClick={() => void detachLink(link._id)}
            title="Unlink"
            aria-label={`Unlink ${rowTitle}`}
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
      <AttachPicker placeholder={pickerPlaceholder} items={pickerItems} onPick={onPick} />
    </div>
  );
}

function AttachPicker({
  placeholder, items, onPick,
}: {
  placeholder: string;
  items:       Array<{ id: string; title: string }>;
  onPick:      (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle ? items.filter(i => i.title.toLowerCase().includes(needle)) : items;
    return base.slice(0, 6);
  }, [items, q]);

  return (
    <div className="tw:relative">
      <input
        className="tw:w-full tw:py-1.5 tw:px-2.5 tw:border tw:border-dashed tw:border-line tw:rounded-app-sm tw:text-[12.5px] tw:outline-none tw:bg-bg tw:text-ink tw:focus:border-ink-3 tw:placeholder:text-ink-4"
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        spellCheck={false}
      />
      {open && filtered.length > 0 && (
        <div className="tw:absolute tw:top-[calc(100%+4px)] tw:left-0 tw:right-0 tw:bg-bg-3 tw:border tw:border-line tw:rounded-[10px] tw:shadow-2 tw:p-1 tw:z-10 tw:max-h-[180px] tw:overflow-y-auto">
          {filtered.map(item => (
            <button
              key={item.id}
              className="tw:w-full tw:text-left tw:py-1.5 tw:px-2 tw:rounded-[6px] tw:text-[12.5px] tw:text-ink tw:truncate tw:hover:bg-bg-2"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onPick(item.id); setQ(""); }}
              title={item.title}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}