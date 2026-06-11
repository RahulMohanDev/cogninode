// src/pages/GraphEditor.tsx
// The knowledge-graph editor shell. One unified node type lives on the
// canvas: every node is label + notes + color, optionally holding attached
// data (a chat, a branch subtree, or a reflection) — the node's retrieval
// corpus. An undeletable ROOT anchors the graph; edges connect anything to
// anything. The resulting structure is the user's hand-engineered RAG
// index — the dock chat retrieves by walking exactly this graph.
//
// This file is just composition: data via liveQuery, canvas in
// components/graph/GraphCanvas, side panel in NodePanel, sources in
// LibraryDrawer. Everything writes straight to Dexie via lib/knowledge.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  db,
  type Chat, type GraphEdge, type GraphNode,
  type Node as DbNode, type Reflection,
} from "../lib/db";
import { renameGraph, unfoldNode } from "../lib/knowledge";
import { planSubtreeSources } from "../lib/flowGraph";
import { displayTitle, type SourceResolvers } from "../lib/graphFlow";
import { GraphCanvas } from "../components/graph/GraphCanvas";
import { GraphDock, type DockMode } from "../components/graph/GraphDock";
import { LibraryDrawer } from "../components/graph/LibraryDrawer";
import { NodePanel } from "../components/graph/NodePanel";
import { Sidebar } from "../components/chat/Sidebar";
import { SettingsModal } from "../components/settings/SettingsModal";
import { useSettings } from "../hooks/useSettings";
import { useSettingsHotkey } from "../hooks/useSettingsHotkey";
import { useToast } from "../components/ui/Toast";

export default function GraphEditor() {
  const { graphId = "" } = useParams<{ graphId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { prefs } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useSettingsHotkey(() => setSettingsOpen(true));

  const [searchParams] = useSearchParams();
  // ?node= deep link from ⌘K (?concept= kept as a legacy fallback).
  const focusNodeId = searchParams.get("node") ?? searchParams.get("concept");

  const graph = useLiveQuery(
    () => (graphId ? db.graphs.get(graphId) : undefined),
    [graphId],
  );
  const graphNodes = useLiveQuery(
    () => db.graphNodes.where("graphId").equals(graphId).toArray(),
    [graphId], [] as GraphNode[],
  );
  const graphEdges = useLiveQuery(
    () => db.graphEdges.where("graphId").equals(graphId).toArray(),
    [graphId], [] as GraphEdge[],
  );
  const chats       = useLiveQuery(() => db.chats.toArray(), [], [] as Chat[]);
  const dbNodes     = useLiveQuery(() => db.nodes.toArray(), [], [] as DbNode[]);
  const reflections = useLiveQuery(() => db.reflections.toArray(), [], [] as Reflection[]);

  const chatById = useMemo(() => new Map(chats.map(c => [c._id, c])), [chats]);
  const nodeById = useMemo(() => new Map(dbNodes.map(n => [n._id, n])), [dbNodes]);
  const refById  = useMemo(() => new Map(reflections.map(r => [r._id, r])), [reflections]);

  // Dock chats are invisible as sources — a graph can't feed on itself.
  const sourceChats = useMemo(() => chats.filter(c => !c.graphId), [chats]);

  const resolvers = useMemo<SourceResolvers>(() => ({
    chatTitle: id => chatById.get(id)?.title,
    nodeInfo: id => {
      const n = nodeById.get(id);
      if (!n) return undefined;
      return {
        label:     n.label,
        chatId:    n.chatId,
        chatTitle: chatById.get(n.chatId)?.title ?? "?",
        isRoot:    n.parentId === null,
      };
    },
    reflectionTitle: id => refById.get(id)?.title,
  }), [chatById, nodeById, refById]);

  const [selectedId, setSelectedId] = useState<string | null>(focusNodeId);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Dock: closed bar · open split · maximized chat (canvas tucked away).
  const [dockMode, setDockMode] = useState<DockMode>("closed");
  // Re-frame the canvas whenever the dock changes its height.
  const [fitNonce, setFitNonce] = useState(0);
  const changeDockMode = (m: DockMode): void => {
    setDockMode(m);
    if (m !== "max") setFitNonce(n => n + 1);   // canvas visible + resized
  };
  // Nodes the latest dock answer retrieved from (set by GraphDock).
  const [glowIds, setGlowIds] = useState<Set<string> | null>(null);
  // One-shot "center this node" requests (citation chips → canvas).
  const [centerRequest, setCenterRequest] = useState<{ id: string; nonce: number } | null>(null);

  useEffect(() => {
    if (!glowIds) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setGlowIds(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [glowIds]);

  const selectedNode = useMemo(
    () => graphNodes.find(n => n._id === selectedId) ?? null,
    [graphNodes, selectedId],
  );

  // Unfold plan for the selected node: how many cards its tree would add.
  const unfoldCount = useMemo(() => {
    const a = selectedNode?.attachment;
    if (!selectedNode || !a || a.type === "reflection") return 0;
    if (a.type === "node" && a.scope === "single") return 0;
    const chatId = a.type === "chat" ? a.targetId : nodeById.get(a.targetId)?.chatId;
    if (!chatId) return 0;
    const chatNodes = dbNodes.filter(n => n.chatId === chatId);
    const plan = planSubtreeSources(
      chatId, chatNodes,
      a.type === "chat" ? null : a.targetId,
      { x: selectedNode.x, y: selectedNode.y },
    );
    return Math.max(0, plan.length - 1);
  }, [selectedNode, dbNodes, nodeById]);

  const doUnfold = (graphNodeId: string): void => {
    void unfoldNode(graphId, graphNodeId).then(res => {
      if (!res) {
        toast("Nothing to unfold here.", { kind: "error" });
      } else if (res.added > 0) {
        toast(`Unfolded — ${res.added} new card${res.added === 1 ? "" : "s"}. Prune what you don't need.`, { kind: "success" });
      } else {
        toast("That tree is already on the canvas.", { kind: "success" });
      }
    });
  };

  // "Not found" grace, mirroring Chat.tsx.
  const [tookTooLong, setTookTooLong] = useState(false);
  useEffect(() => {
    setTookTooLong(false);
    const t = setTimeout(() => setTookTooLong(true), 250);
    return () => clearTimeout(t);
  }, [graphId]);

  // Inline graph rename (also renames the root node).
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const committedRef = useRef(false);
  const commitName = (): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    setRenaming(false);
    void renameGraph(graphId, nameDraft);
  };

  const attachedCount = useMemo(
    () => graphNodes.filter(n => n.attachment).length,
    [graphNodes],
  );

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
              title="Rename graph (renames the root too)"
            >
              {graph?.name ?? "…"}
            </button>
          )}

          <span className="tw:font-mono tw:text-[11px] tw:text-ink-3 tw:tracking-[0.06em] tw:uppercase tw:flex-none">
            {graphNodes.length} node{graphNodes.length === 1 ? "" : "s"} · {attachedCount} attached
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

          <div className="tw:flex-1 tw:flex tw:flex-col tw:min-w-0 tw:min-h-0">
            {/* React Flow stays mounted while maximized — just hidden — so
                glow state, viewport, and selection survive the round trip. */}
            <div className={`tw:flex-1 tw:relative tw:min-w-0 tw:min-h-0 ${dockMode === "max" ? "tw:hidden" : ""}`}>
              <ReactFlowProvider>
                <GraphCanvas
                  graphId={graphId}
                  rootNodeId={graph?.rootNodeId ?? ""}
                  graphNodes={graphNodes}
                  graphEdges={graphEdges}
                  resolvers={resolvers}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  focusNodeId={focusNodeId}
                  libraryOpen={libraryOpen}
                  onToggleLibrary={() => setLibraryOpen(v => !v)}
                  onUnfold={doUnfold}
                  glowIds={glowIds}
                  centerRequest={centerRequest}
                  fitNonce={fitNonce}
                />
              </ReactFlowProvider>
            </div>
            <GraphDock
              graphId={graphId}
              graphName={graph?.name ?? "this graph"}
              mode={dockMode}
              onModeChange={changeDockMode}
              getNodeLabel={id => {
                const n = graphNodes.find(x => x._id === id);
                return n ? displayTitle(n, resolvers).title : "(removed node)";
              }}
              onGlow={setGlowIds}
              onFocusNode={id => {
                // Bring the canvas back if the chat had taken the column —
                // a citation click means "show me the node".
                setDockMode(m => (m === "max" ? "open" : m));
                setSelectedId(id);
                setCenterRequest({ id, nonce: Date.now() });
              }}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>

          {selectedNode && (
            <NodePanel
              key={selectedNode._id}
              graphId={graphId}
              node={selectedNode}
              edges={graphEdges}
              allNodes={graphNodes}
              resolvers={resolvers}
              chats={sourceChats}
              reflections={reflections}
              unfoldCount={unfoldCount}
              onUnfold={() => doUnfold(selectedNode._id)}
              onSelectNode={setSelectedId}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
