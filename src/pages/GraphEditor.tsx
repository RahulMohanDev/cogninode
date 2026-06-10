// src/pages/GraphEditor.tsx
// The knowledge-graph playground. Two kinds of nodes share the canvas:
//
//   · CONCEPT nodes — the user's own classification (create by
//     double-click, rename, color, notes). They never need anything
//     attached; pure structure is the point.
//   · SOURCE nodes — chats, branches (subtree roots), or reflections
//     dragged in from the Library drawer at WHATEVER granularity the
//     user wants. They're real canvas citizens: positioned, connectable.
//
// Edges connect anything to anything. The resulting graph is the user's
// hand-engineered retrieval index — traversal-RAG walks exactly this
// structure later. Everything writes straight to Dexie; liveQuery keeps
// the canvas in sync.

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
  type Node as FlowNode,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  db,
  type Chat, type Concept, type ConceptEdge, type GraphSource,
  type Node as DbNode, type Reflection,
} from "../lib/db";
import {
  CONCEPT_COLORS,
  addConceptEdge, addSource, attachToConcept, createConcept,
  deleteConcept, deleteConceptEdge, deleteSource, expandSourceTree,
  moveConcept, moveSource, renameGraph, updateConcept,
} from "../lib/knowledge";
import {
  buildConceptFlowGraph, planSubtreeSources, resolveSourceDisplay,
  type ConceptNodeData, type SourceResolvers,
} from "../lib/flowGraph";
import { buildTree, type TreeNode } from "../lib/path";
import { ConceptNode } from "../components/graph/ConceptNode";
import { SourceNode } from "../components/graph/SourceNode";
import { miniMapStyle, useFlowTheme } from "../components/graph/flowTheme";
import { Sidebar } from "../components/chat/Sidebar";
import { SettingsModal } from "../components/settings/SettingsModal";
import { useSettings } from "../hooks/useSettings";
import { useSettingsHotkey } from "../hooks/useSettingsHotkey";
import { useToast } from "../components/ui/Toast";

const nodeTypes = { concept: ConceptNode, source: SourceNode };

const DRAG_MIME = "application/x-cogninode-source";

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
    [graphId], [] as ConceptEdge[],
  );
  const sources = useLiveQuery(
    () => db.graphSources.where("graphId").equals(graphId).toArray(),
    [graphId], [] as GraphSource[],
  );
  const chats       = useLiveQuery(() => db.chats.toArray(), [], [] as Chat[]);
  const dbNodes     = useLiveQuery(() => db.nodes.toArray(), [], [] as DbNode[]);
  const reflections = useLiveQuery(() => db.reflections.toArray(), [], [] as Reflection[]);

  const chatById = useMemo(() => new Map(chats.map(c => [c._id, c])), [chats]);
  const nodeById = useMemo(() => new Map(dbNodes.map(n => [n._id, n])), [dbNodes]);
  const refById  = useMemo(() => new Map(reflections.map(r => [r._id, r])), [reflections]);

  const resolvers = useMemo<SourceResolvers>(() => ({
    chatTitle: id => chatById.get(id)?.title,
    nodeInfo: id => {
      const n = nodeById.get(id);
      if (!n) return undefined;
      return { label: n.label, chatId: n.chatId, chatTitle: chatById.get(n.chatId)?.title ?? "?" };
    },
    reflectionTitle: id => refById.get(id)?.title,
  }), [chatById, nodeById, refById]);

  const [selectedId, setSelectedId] = useState<string | null>(focusConceptId);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const selectedConcept = useMemo(
    () => concepts.find(c => c._id === selectedId) ?? null,
    [concepts, selectedId],
  );
  const selectedSource = useMemo(
    () => sources.find(s => s._id === selectedId) ?? null,
    [sources, selectedId],
  );

  // Unfold plan for the selected chat/branch source (its subtree as cards,
  // rooted at the card's current position).
  const expandPlan = useMemo(() => {
    if (!selectedSource || selectedSource.targetType === "reflection") return null;
    const chatId = selectedSource.targetType === "chat"
      ? selectedSource.targetId
      : nodeById.get(selectedSource.targetId)?.chatId;
    if (!chatId) return null;
    const chatNodes = dbNodes.filter(n => n.chatId === chatId);
    const plan = planSubtreeSources(
      chatId, chatNodes,
      selectedSource.targetType === "chat" ? null : selectedSource.targetId,
      { x: selectedSource.x, y: selectedSource.y },
    );
    return plan.length > 1 ? plan : null;
  }, [selectedSource, dbNodes, nodeById]);

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
            {concepts.length} concept{concepts.length === 1 ? "" : "s"} · {sources.length} source{sources.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="tw:flex-1 tw:flex tw:min-h-0">
          {libraryOpen && (
            <LibraryDrawer
              chats={chats}
              dbNodes={dbNodes}
              reflections={reflections}
              onClose={() => setLibraryOpen(false)}
            />
          )}

          <div className="tw:flex-1 tw:relative tw:min-w-0">
            <ReactFlowProvider>
              <ConceptCanvas
                graphId={graphId}
                concepts={concepts}
                sources={sources}
                conceptEdges={conceptEdges}
                resolvers={resolvers}
                selectedId={selectedId}
                onSelect={setSelectedId}
                focusConceptId={focusConceptId}
                libraryOpen={libraryOpen}
                onToggleLibrary={() => setLibraryOpen(v => !v)}
              />
            </ReactFlowProvider>
          </div>

          {selectedConcept && (
            <ConceptPanel
              key={selectedConcept._id}
              graphId={graphId}
              concept={selectedConcept}
              edges={conceptEdges}
              sources={sources}
              resolvers={resolvers}
              chats={chats}
              reflections={reflections}
              onClose={() => setSelectedId(null)}
            />
          )}
          {!selectedConcept && selectedSource && (
            <SourcePanel
              key={selectedSource._id}
              source={selectedSource}
              edges={conceptEdges}
              concepts={concepts}
              resolvers={resolvers}
              expandCount={expandPlan ? expandPlan.length - 1 : 0}
              onExpand={expandPlan ? () => void expandSourceTree(graphId, expandPlan) : undefined}
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
  graphId:         string;
  concepts:        Concept[];
  sources:         GraphSource[];
  conceptEdges:    ConceptEdge[];
  resolvers:       SourceResolvers;
  selectedId:      string | null;
  onSelect:        (id: string | null) => void;
  focusConceptId:  string | null;
  libraryOpen:     boolean;
  onToggleLibrary: () => void;
}

function ConceptCanvas({
  graphId, concepts, sources, conceptEdges, resolvers,
  selectedId, onSelect, focusConceptId, libraryOpen, onToggleLibrary,
}: ConceptCanvasProps) {
  const { prefs } = useSettings();
  const toast = useToast();
  const flow = useReactFlow();
  const mini = useFlowTheme(prefs.theme);

  const conceptIds = useMemo(() => new Set(concepts.map(c => c._id)), [concepts]);

  const graphData = useMemo(
    () => buildConceptFlowGraph(concepts, sources, conceptEdges, resolvers),
    [concepts, sources, conceptEdges, resolvers],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(graphData.nodes as FlowNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphData.edges as FlowEdge[]);

  // Re-sync from Dexie — but never mid-drag, or the dragged card would
  // snap back to its last persisted position.
  const draggingRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current) return;
    setNodes(
      (graphData.nodes as FlowNode[]).map(n =>
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

  const addConceptAtScreen = useCallback(async (clientX: number, clientY: number) => {
    const pos = flow.screenToFlowPosition({ x: clientX, y: clientY });
    const id = await createConcept(graphId, { x: pos.x - 100, y: pos.y - 30 });
    onSelect(id);
  }, [flow, graphId, onSelect]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) void addConceptEdge(graphId, c.source, c.target);
  }, [graphId]);

  // Library drag → drop. Chats and branches UNFOLD: the whole subtree
  // lands as individual cards joined by dashed lineage edges, ready for
  // pruning — delete the cards you don't want classified. Reflections
  // stay single cards. Dropping onto a concept also wires concept → root.
  const onDrop = useCallback(async (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    let payload: { targetType: GraphSource["targetType"]; targetId: string; title: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    const hitNode = (e.target as HTMLElement).closest(".react-flow__node");
    const hitId = hitNode?.getAttribute("data-id");
    const hitConcept = hitId && conceptIds.has(hitId)
      ? concepts.find(c => c._id === hitId) ?? null
      : null;

    // Where the root card lands: at the cursor, or fanned out beside the
    // concept it was dropped on.
    const pos = hitConcept
      ? { x: hitConcept.x + 280, y: hitConcept.y }
      : (() => {
          const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          return { x: p.x - 95, y: p.y - 28 };
        })();

    let rootSourceId: string | null = null;
    let summary = "";

    if (payload.targetType === "reflection") {
      const { id, created } = await addSource(graphId, {
        targetType: "reflection", targetId: payload.targetId, ...pos,
      });
      rootSourceId = id;
      if (!created && !hitConcept) {
        await moveSource(id, pos.x, pos.y);
        summary = "Already on this canvas — moved it here";
      }
    } else {
      // Chat or branch: plan + unfold the subtree.
      const chatId = payload.targetType === "chat"
        ? payload.targetId
        : (await db.nodes.get(payload.targetId))?.chatId;
      if (!chatId) return;
      const chatNodes = await db.nodes.where("chatId").equals(chatId).toArray();
      const plan = planSubtreeSources(
        chatId, chatNodes,
        payload.targetType === "chat" ? null : payload.targetId,
        pos,
      );
      const res = await expandSourceTree(graphId, plan);
      rootSourceId = res.rootSourceId;
      summary = res.added > 0
        ? `Unfolded "${payload.title}" — ${res.added} card${res.added === 1 ? "" : "s"}. Prune what you don't need.`
        : "Already on this canvas.";
    }

    if (hitConcept && rootSourceId) {
      await addConceptEdge(graphId, hitConcept._id, rootSourceId);
      toast(`Connected "${payload.title}" to ${hitConcept.label}${summary ? ` · ${summary}` : ""}`, { kind: "success" });
    } else if (summary) {
      toast(summary, { kind: "success" });
    }
    if (rootSourceId) onSelect(rootSourceId);
  }, [graphId, conceptIds, concepts, flow, onSelect, toast]);

  return (
    <div
      className="tw:absolute tw:inset-0"
      onDoubleClick={e => {
        const t = e.target as HTMLElement;
        if (!t.closest(".react-flow__pane")) return;
        void addConceptAtScreen(e.clientX, e.clientY);
      }}
      onDragOver={e => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={e => void onDrop(e)}
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
          for (const n of moved) {
            if (n.type === "concept") void moveConcept(n.id, n.position.x, n.position.y);
            else void moveSource(n.id, n.position.x, n.position.y);
          }
        }}
        onNodesDelete={deleted => {
          for (const n of deleted) {
            if (n.type === "concept") void deleteConcept(n.id);
            else void deleteSource(n.id);
          }
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
          nodeColor={n =>
            n.type === "concept"
              ? mini.accents[(n.data as ConceptNodeData).color] ?? mini.stroke
              : mini.stroke}
          nodeStrokeWidth={3}
          nodeBorderRadius={4}
          maskColor={mini.mask}
          style={miniMapStyle(mini)}
        />
        <Panel position="top-left">
          <div className="tw:flex tw:gap-2">
            <button
              className={`tw:py-2 tw:px-3.5 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:shadow-1 tw:inline-flex tw:items-center tw:gap-1.5 ${libraryOpen ? "tw:bg-teal tw:text-white tw:border-teal" : "tw:bg-bg-3 tw:text-ink tw:border-line tw:hover:border-ink-3"}`}
              onClick={onToggleLibrary}
              aria-pressed={libraryOpen}
              title="Browse chats & branches to drag onto the canvas"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2" y="2.5" width="12" height="3.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <rect x="2" y="9" width="12" height="3.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
              </svg>
              Library
            </button>
            <button
              className="tw:bg-bg-3 tw:text-ink tw:py-2 tw:px-3.5 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:shadow-1 tw:inline-flex tw:items-center tw:gap-1.5 tw:hover:border-ink-3"
              onClick={() => {
                const el = document.querySelector(".react-flow__pane");
                const r = el?.getBoundingClientRect();
                void addConceptAtScreen(r ? r.left + r.width / 2 : window.innerWidth / 2, r ? r.top + r.height / 2 : window.innerHeight / 2);
              }}
            >
              + Concept
            </button>
          </div>
        </Panel>
        {concepts.length === 0 && sources.length === 0 && (
          <Panel position="top-center">
            <div className="tw:mt-16 tw:py-2.5 tw:px-4 tw:rounded-[999px] tw:bg-bg-2 tw:border tw:border-line tw:text-[13px] tw:text-ink-2 tw:shadow-1 tw:text-center">
              Double-click to add a concept — or open the Library and drag
              chats &amp; branches in.
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

// ── library drawer ─────────────────────────────────────────────────────
// Every chat with its full branch tree, plus reflections — each row
// draggable onto the canvas. This is where the granularity lives: whole
// chats, single branches, entire subtrees (a branch row stands for its
// subtree), reflections.

function LibraryDrawer({
  chats, dbNodes, reflections, onClose,
}: {
  chats:       Chat[];
  dbNodes:     DbNode[];
  reflections: Reflection[];
  onClose:     () => void;
}) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const nodesByChat = useMemo(() => {
    const map = new Map<string, DbNode[]>();
    for (const n of dbNodes) {
      const arr = map.get(n.chatId) ?? [];
      arr.push(n);
      map.set(n.chatId, arr);
    }
    return map;
  }, [dbNodes]);

  const needle = q.trim().toLowerCase();
  const visibleChats = needle
    ? chats.filter(c => c.title.toLowerCase().includes(needle))
    : chats;
  const visibleReflections = needle
    ? reflections.filter(r => r.title.toLowerCase().includes(needle))
    : reflections;

  const toggle = (chatId: string): void => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId); else next.add(chatId);
      return next;
    });
  };

  const startDrag = (
    e: React.DragEvent,
    payload: { targetType: GraphSource["targetType"]; targetId: string; title: string },
  ): void => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  };

  // Flatten a chat's branch tree (skipping the root — it mirrors the chat).
  const branchRows = (chatId: string): Array<{ node: DbNode; depth: number }> => {
    const roots = buildTree(nodesByChat.get(chatId) ?? []);
    const out: Array<{ node: DbNode; depth: number }> = [];
    const visit = (tn: TreeNode, depth: number): void => {
      out.push({ node: tn.node, depth });
      for (const child of tn.children) visit(child, depth + 1);
    };
    for (const root of roots) for (const child of root.children) visit(child, 0);
    return out;
  };

  return (
    <div className="tw:w-[280px] tw:flex-none tw:border-r tw:border-line tw:bg-bg tw:flex tw:flex-col tw:min-h-0">
      <div className="tw:flex tw:items-center tw:gap-2 tw:py-3 tw:px-3.5 tw:border-b tw:border-line">
        <span className="tw:font-mono tw:text-[10px] tw:tracking-[0.14em] tw:uppercase tw:text-ink-3 tw:flex-1">Library</span>
        <button
          className="tw:w-[26px] tw:h-[26px] tw:grid tw:place-items-center tw:rounded-[7px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink"
          onClick={onClose}
          title="Close library"
          aria-label="Close library"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="tw:p-2.5">
        <input
          className="tw:w-full tw:py-2 tw:px-3 tw:border tw:border-line tw:bg-bg-3 tw:rounded-app-sm tw:text-[12.5px] tw:outline-none tw:focus:border-ink-3 tw:placeholder:text-ink-4"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Filter chats & reflections…"
          spellCheck={false}
        />
        <p className="tw:m-0 tw:mt-1.5 tw:text-[11px] tw:text-ink-3">
          Drag a chat or branch in — its subtree unfolds into cards.
          Delete the ones you don't need; drop onto a concept to connect.
        </p>
      </div>

      <div className="tw:flex-1 tw:overflow-y-auto tw:px-2 tw:pb-3 tw:[scrollbar-width:thin] tw:[scrollbar-color:var(--line)_transparent]">
        {visibleChats.map(chat => {
          const isOpen = expanded.has(chat._id);
          const branches = isOpen ? branchRows(chat._id) : [];
          return (
            <div key={chat._id}>
              <div
                className="tw:flex tw:items-center tw:gap-1.5 tw:py-[7px] tw:px-2 tw:rounded-[7px] tw:text-[12.5px] tw:text-ink tw:cursor-grab tw:hover:bg-bg-2"
                draggable
                onDragStart={e => startDrag(e, { targetType: "chat", targetId: chat._id, title: chat.title || "Untitled chat" })}
              >
                <button
                  className={`tw:w-4 tw:h-4 tw:grid tw:place-items-center tw:flex-none tw:rounded-[4px] tw:text-ink-3 tw:hover:bg-[rgba(0,0,0,0.06)] tw:hover:text-ink ${isOpen ? "tw:[transform:rotate(90deg)]" : ""}`}
                  onClick={e => { e.stopPropagation(); toggle(chat._id); }}
                  title={isOpen ? "Collapse branches" : "Show branches"}
                >
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path d="M3 2 L7 5 L3 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <svg className="tw:flex-none tw:text-ink-3" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2.5 3.5 H13.5 V11 H8.5 L5.5 13.5 V11 H2.5 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <span className="tw:flex-1 tw:min-w-0 tw:truncate">{chat.title || "Untitled chat"}</span>
              </div>

              {isOpen && branches.map(({ node, depth }) => (
                <div
                  key={node._id}
                  className="tw:flex tw:items-center tw:gap-1.5 tw:py-[5px] tw:px-2 tw:rounded-[7px] tw:text-[12px] tw:text-ink-2 tw:cursor-grab tw:hover:bg-bg-2 tw:hover:text-ink"
                  style={{ paddingLeft: 26 + depth * 14 }}
                  draggable
                  onDragStart={e => startDrag(e, { targetType: "node", targetId: node._id, title: node.label || "branch" })}
                  title={`Drag this branch (and its subtree) onto the canvas`}
                >
                  <span className={`tw:w-[7px] tw:h-[7px] tw:rounded-[50%] tw:flex-none ${["tw:bg-teal", "tw:bg-lilac", "tw:bg-butter"][Math.min(2, depth)]}`} />
                  <span className="tw:flex-1 tw:min-w-0 tw:truncate">{node.label || "(no label)"}</span>
                </div>
              ))}
            </div>
          );
        })}

        {visibleReflections.length > 0 && (
          <div className="tw:font-mono tw:text-[9px] tw:tracking-[0.14em] tw:uppercase tw:text-ink-3 tw:pt-3 tw:px-2 tw:pb-1">Reflections</div>
        )}
        {visibleReflections.map(r => (
          <div
            key={r._id}
            className="tw:flex tw:items-center tw:gap-1.5 tw:py-[6px] tw:px-2 tw:rounded-[7px] tw:text-[12px] tw:text-ink-2 tw:cursor-grab tw:hover:bg-bg-2 tw:hover:text-ink"
            draggable
            onDragStart={e => startDrag(e, { targetType: "reflection", targetId: r._id, title: r.title || "Untitled reflection" })}
          >
            <svg className="tw:flex-none tw:text-ink-3" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M1.8 8 C4 4.7 12 4.7 14.2 8 C12 11.3 4 11.3 1.8 8 Z" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="8" cy="8" r="1.6" fill="currentColor" />
            </svg>
            <span className="tw:flex-1 tw:min-w-0 tw:truncate">{r.title || "Untitled reflection"}</span>
          </div>
        ))}

        {visibleChats.length === 0 && visibleReflections.length === 0 && (
          <div className="tw:py-5 tw:px-3 tw:text-ink-3 tw:text-[12px] tw:text-center">Nothing matches "{q}".</div>
        )}
      </div>
    </div>
  );
}

// ── concept side panel ─────────────────────────────────────────────────

interface ConceptPanelProps {
  graphId:     string;
  concept:     Concept;
  edges:       ConceptEdge[];
  sources:     GraphSource[];
  resolvers:   SourceResolvers;
  chats:       Chat[];
  reflections: Reflection[];
  onClose:     () => void;
}

function ConceptPanel({
  graphId, concept, edges, sources, resolvers, chats, reflections, onClose,
}: ConceptPanelProps) {
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

  const sourceById = useMemo(() => new Map(sources.map(s => [s._id, s])), [sources]);

  // Sources connected to this concept (either edge direction).
  const connected = useMemo(() => {
    const out: Array<{ edgeId: string; source: GraphSource }> = [];
    for (const e of edges) {
      const otherId = e.source === concept._id ? e.target : e.target === concept._id ? e.source : null;
      if (!otherId) continue;
      const s = sourceById.get(otherId);
      if (s) out.push({ edgeId: e._id, source: s });
    }
    return out;
  }, [edges, concept._id, sourceById]);

  const connectedTargetIds = useMemo(
    () => new Set(connected.map(c => c.source.targetId)),
    [connected],
  );

  const attach = (targetType: "chat" | "reflection") => (targetId: string): void => {
    void attachToConcept({ graphId, conceptId: concept._id, targetType, targetId })
      .catch(err => toast(`Couldn't attach: ${(err as Error).message}`, { kind: "error" }));
  };

  return (
    <div className="tw:w-[320px] tw:flex-none tw:border-l tw:border-line tw:bg-bg tw:flex tw:flex-col tw:overflow-y-auto tw:[scrollbar-width:thin] tw:[scrollbar-color:var(--line)_transparent]">
      <PanelHeader label="Concept" onClose={onClose} />

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

        <div className="tw:flex tw:flex-col tw:gap-1.5">
          <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">
            Connected{connected.length > 0 ? ` · ${connected.length}` : ""}
          </label>
          {connected.map(({ edgeId, source }) => {
            const display = resolveSourceDisplay(source, resolvers);
            return (
              <div key={edgeId} className="tw:group/att tw:flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-2 tw:rounded-[8px] tw:border tw:border-line-2 tw:bg-bg-3 tw:text-[12.5px] tw:text-ink tw:min-w-0">
                <span className="tw:font-mono tw:text-[8.5px] tw:tracking-[0.08em] tw:uppercase tw:text-ink-4 tw:flex-none">{source.targetType === "node" ? "branch" : source.targetType}</span>
                <button
                  className="tw:flex-1 tw:min-w-0 tw:truncate tw:text-left tw:p-0 tw:hover:text-coral tw:disabled:opacity-60"
                  onClick={() => { if (display.href) navigate(display.href); }}
                  disabled={!display.href}
                  title={`Open: ${display.title}`}
                >
                  {display.title}
                </button>
                <button
                  className="tw:w-[20px] tw:h-[20px] tw:grid tw:place-items-center tw:rounded-[5px] tw:flex-none tw:text-ink-4 tw:opacity-0 tw:group-hover/att:opacity-100 tw:hover:bg-[color-mix(in_oklab,var(--coral)_18%,transparent)] tw:hover:text-coral"
                  onClick={() => void deleteConceptEdge(edgeId)}
                  title="Disconnect (the source stays on the canvas)"
                  aria-label={`Disconnect ${display.title}`}
                >
                  <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                    <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })}

          <AttachPicker
            placeholder="Attach a chat…"
            items={chats.filter(c => !connectedTargetIds.has(c._id)).map(c => ({ id: c._id, title: c.title || "Untitled chat" }))}
            onPick={attach("chat")}
          />
          <AttachPicker
            placeholder="Attach a reflection…"
            items={reflections.filter(r => !connectedTargetIds.has(r._id)).map(r => ({ id: r._id, title: r.title || "Untitled reflection" }))}
            onPick={attach("reflection")}
          />
          <p className="tw:m-0 tw:text-[11px] tw:text-ink-4">
            Branches: open the Library and drag them in.
          </p>
        </div>

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

// ── source side panel ──────────────────────────────────────────────────

function SourcePanel({
  source, edges, concepts, resolvers, expandCount = 0, onExpand, onClose,
}: {
  source:      GraphSource;
  edges:       ConceptEdge[];
  concepts:    Concept[];
  resolvers:   SourceResolvers;
  expandCount?: number;
  onExpand?:   (() => void) | undefined;
  onClose:     () => void;
}) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const display = resolveSourceDisplay(source, resolvers);
  const conceptById = useMemo(() => new Map(concepts.map(c => [c._id, c])), [concepts]);

  const connectedConcepts = useMemo(() => {
    const out: Array<{ edgeId: string; concept: Concept }> = [];
    for (const e of edges) {
      const otherId = e.source === source._id ? e.target : e.target === source._id ? e.source : null;
      if (!otherId) continue;
      const c = conceptById.get(otherId);
      if (c) out.push({ edgeId: e._id, concept: c });
    }
    return out;
  }, [edges, source._id, conceptById]);

  return (
    <div className="tw:w-[320px] tw:flex-none tw:border-l tw:border-line tw:bg-bg tw:flex tw:flex-col tw:overflow-y-auto tw:[scrollbar-width:thin] tw:[scrollbar-color:var(--line)_transparent]">
      <PanelHeader label={source.targetType === "node" ? "Branch" : source.targetType === "chat" ? "Chat" : "Reflection"} onClose={onClose} />

      <div className="tw:p-4 tw:flex tw:flex-col tw:gap-4">
        <div>
          <div className="tw:font-mono tw:text-[10px] tw:tracking-[0.1em] tw:uppercase tw:text-ink-3 tw:mb-1">{display.subtitle}</div>
          <div className={`tw:font-display tw:font-semibold tw:text-[17px] tw:tracking-[-0.01em] tw:leading-[1.25] ${display.stale ? "tw:text-ink-3 tw:line-through" : "tw:text-ink"}`}>
            {display.title}
          </div>
        </div>

        {display.href && !display.stale && (
          <button
            className="tw:w-full tw:py-2 tw:px-3 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:text-ink tw:bg-bg-3 tw:hover:border-ink-3"
            onClick={() => navigate(display.href)}
          >
            Open {source.targetType === "node" ? "branch" : source.targetType} →
          </button>
        )}
        {onExpand && expandCount > 0 && (
          <button
            className="tw:w-full tw:py-2 tw:px-3 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:text-ink tw:bg-bg-3 tw:hover:border-ink-3"
            onClick={onExpand}
            title="Spread this subtree's branches onto the canvas as cards you can prune"
          >
            Unfold {expandCount} branch{expandCount === 1 ? "" : "es"}
          </button>
        )}
        {display.stale && (
          <p className="tw:m-0 tw:text-[12px] tw:text-coral">
            The underlying {source.targetType === "node" ? "branch" : source.targetType} was deleted — remove this node when you're done with it.
          </p>
        )}

        <div className="tw:flex tw:flex-col tw:gap-1.5">
          <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">
            Classified under{connectedConcepts.length > 0 ? ` · ${connectedConcepts.length}` : ""}
          </label>
          {connectedConcepts.length === 0 && (
            <p className="tw:m-0 tw:text-[12px] tw:text-ink-4">Not connected yet — drag from its handle to a concept.</p>
          )}
          {connectedConcepts.map(({ edgeId, concept }) => (
            <div key={edgeId} className="tw:group/att tw:flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-2 tw:rounded-[8px] tw:border tw:border-line-2 tw:bg-bg-3 tw:text-[12.5px] tw:text-ink tw:min-w-0">
              <span className={`tw:w-2 tw:h-2 tw:rounded-[50%] tw:flex-none ${COLOR_BG[concept.color]}`} />
              <span className="tw:flex-1 tw:min-w-0 tw:truncate">{concept.label}</span>
              <button
                className="tw:w-[20px] tw:h-[20px] tw:grid tw:place-items-center tw:rounded-[5px] tw:flex-none tw:text-ink-4 tw:opacity-0 tw:group-hover/att:opacity-100 tw:hover:bg-[color-mix(in_oklab,var(--coral)_18%,transparent)] tw:hover:text-coral"
                onClick={() => void deleteConceptEdge(edgeId)}
                title="Disconnect"
                aria-label={`Disconnect from ${concept.label}`}
              >
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="tw:pt-2 tw:border-t tw:border-line-2">
          {confirming ? (
            <div className="tw:flex tw:items-center tw:gap-1.5 tw:px-2.5 tw:py-1.5 tw:bg-[color-mix(in_oklab,var(--coral)_12%,var(--bg-3))] tw:border tw:border-[color-mix(in_oklab,var(--coral)_30%,var(--line))] tw:rounded-[8px] tw:text-[12px] tw:text-ink">
              <span className="tw:flex-1">Remove from canvas?</span>
              <button className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:text-coral tw:font-semibold tw:hover:bg-coral tw:hover:text-white" onClick={() => { void deleteSource(source._id); onClose(); }}>yes</button>
              <span className="tw:text-ink-4">·</span>
              <button className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink" onClick={() => setConfirming(false)}>cancel</button>
            </div>
          ) : (
            <button
              className="tw:w-full tw:py-2 tw:px-3 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-coral tw:text-coral tw:bg-bg tw:hover:bg-coral-tint"
              onClick={() => setConfirming(true)}
              title="Removes the node and its connections — the chat/reflection itself is untouched"
            >
              Remove from canvas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── shared bits ────────────────────────────────────────────────────────

function PanelHeader({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="tw:flex tw:items-center tw:gap-2 tw:py-3 tw:px-4 tw:border-b tw:border-line">
      <span className="tw:font-mono tw:text-[10px] tw:tracking-[0.14em] tw:uppercase tw:text-ink-3 tw:flex-1">{label}</span>
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