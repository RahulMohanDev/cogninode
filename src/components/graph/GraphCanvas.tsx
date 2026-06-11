// src/components/graph/GraphCanvas.tsx
// The knowledge-graph canvas: one unified node type, any-to-any edges,
// n8n-style direct manipulation. Owns React Flow state + the interaction
// layer (drops, context menus, edge labels, Tidy); all persistence goes
// through lib/knowledge.ts and re-renders via liveQuery upstream.
//
//   · drop = ONE node (branch drops cover their subtree); Unfold is an
//     explicit action on the node, never a surprise on drop
//   · root is pinned into existence — undeletable, anchors Tidy + RAG
//   · right-click anywhere: pane / node / edge menus
//   · double-click pane: new node — double-click edge: label it

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
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

import type { GraphEdge, GraphNode } from "../../lib/db";
import {
  addAttachedNode, addEdge, createNode, deleteEdge, deleteNode,
  disconnectNode, moveNode, moveNodes, updateEdge,
} from "../../lib/knowledge";
import {
  DRAG_MIME, buildGraphFlow, planTidyLayout,
  type DragPayload, type GraphNodeData, type SourceResolvers,
} from "../../lib/graphFlow";
import { GraphNodeView, GraphNodeActionsContext, type GraphNodeActions } from "./GraphNodeView";
import { GraphContextMenu, type MenuItem } from "./GraphContextMenu";
import { miniMapStyle, useFlowTheme } from "./flowTheme";
import { useSettings } from "../../hooks/useSettings";
import { useToast } from "../ui/Toast";

const nodeTypes = { graphNode: GraphNodeView };

interface MenuState {
  kind: "pane" | "node" | "edge";
  x:    number;
  y:    number;
  id?:  string;
}

interface EdgeLabelDraft {
  edgeId: string;
  x:      number;
  y:      number;
  value:  string;
}

export interface GraphCanvasProps {
  graphId:         string;
  rootNodeId:      string;
  graphNodes:      GraphNode[];
  graphEdges:      GraphEdge[];
  resolvers:       SourceResolvers;
  selectedId:      string | null;
  onSelect:        (id: string | null) => void;
  focusNodeId:     string | null;
  libraryOpen:     boolean;
  onToggleLibrary: () => void;
  /** Expand a chat/branch node into its tree (owned by the editor for toasts). */
  onUnfold:        (graphNodeId: string) => void;
  /** Nodes graph-RAG just cited — rendered with a pulsing ring. */
  glowIds:         Set<string> | null;
  /** One-shot pan-to-node requests (nonce re-fires for the same node). */
  centerRequest:   { id: string; nonce: number } | null;
  /** Bumped when the canvas area resizes (dock open/close) — re-frames. */
  fitNonce:        number;
}

export function GraphCanvas({
  graphId, rootNodeId, graphNodes, graphEdges, resolvers,
  selectedId, onSelect, focusNodeId, libraryOpen, onToggleLibrary,
  onUnfold, glowIds, centerRequest, fitNonce,
}: GraphCanvasProps) {
  const { prefs } = useSettings();
  const toast = useToast();
  const navigate = useNavigate();
  const flow = useReactFlow();
  const mini = useFlowTheme(prefs.theme);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<EdgeLabelDraft | null>(null);

  const graphData = useMemo(
    () => buildGraphFlow(graphNodes, graphEdges, resolvers,
      glowIds ? { glowIds } : undefined),
    [graphNodes, graphEdges, resolvers, glowIds],
  );
  const nodeById = useMemo(() => new Map(graphNodes.map(n => [n._id, n])), [graphNodes]);

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

  // Citation chips / dock → pan to a node (nonce re-fires for repeats).
  // Slight delay: the dock may be mid-resize (or just un-hiding the
  // canvas after a maximized chat) — measure after it settles.
  const centerNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!centerRequest || centerNonceRef.current === centerRequest.nonce) return undefined;
    const n = nodeById.get(centerRequest.id);
    if (!n) return undefined;
    centerNonceRef.current = centerRequest.nonce;
    const t = setTimeout(
      () => flow.setCenter(n.x + 100, n.y + 40, { zoom: 1, duration: 500 }),
      230,
    );
    return () => clearTimeout(t);
  }, [centerRequest, nodeById, flow]);

  // Dock opened/closed/restored → re-frame once the height transition
  // (200ms) settles so nothing ends up stranded off-viewport.
  const fitNonceRef = useRef(fitNonce);
  useEffect(() => {
    if (fitNonceRef.current === fitNonce) return undefined;
    fitNonceRef.current = fitNonce;
    const t = setTimeout(
      () => void flow.fitView({ padding: 0.25, maxZoom: 1, duration: 300 }),
      230,
    );
    return () => clearTimeout(t);
  }, [fitNonce, flow]);

  // ?node= deep link (from ⌘K): select + center once per target.
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNodeId || focusedRef.current === focusNodeId) return;
    const n = nodeById.get(focusNodeId);
    if (!n) return;
    focusedRef.current = focusNodeId;
    onSelect(n._id);
    setTimeout(() => flow.setCenter(n.x + 100, n.y + 40, { zoom: 1, duration: 500 }), 120);
  }, [focusNodeId, nodeById, flow, onSelect]);

  const addNodeAtScreen = useCallback(async (clientX: number, clientY: number) => {
    const pos = flow.screenToFlowPosition({ x: clientX, y: clientY });
    const id = await createNode(graphId, { x: pos.x - 100, y: pos.y - 30 });
    onSelect(id);
  }, [flow, graphId, onSelect]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) void addEdge(graphId, c.source, c.target);
  }, [graphId]);

  const tidy = useCallback(async () => {
    const plan = planTidyLayout(graphNodes, graphEdges, rootNodeId);
    if (plan.length === 0) return;
    await moveNodes(plan);
    setTimeout(() => flow.fitView({ padding: 0.25, maxZoom: 1, duration: 400 }), 120);
  }, [graphNodes, graphEdges, rootNodeId, flow]);

  // Library drag → drop = ONE node. The underlying messages are the
  // node's data (branch drops cover their whole subtree); Unfold expands
  // it into prunable cards only when asked. Dropping onto a node also
  // wires an edge to it.
  const onDrop = useCallback(async (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw) as DragPayload;
    } catch {
      return;
    }

    const hitEl = (e.target as HTMLElement).closest(".react-flow__node");
    const hitNode = hitEl ? nodeById.get(hitEl.getAttribute("data-id") ?? "") ?? null : null;

    const pos = hitNode
      ? { x: hitNode.x + 280, y: hitNode.y }
      : (() => {
          const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          return { x: p.x - 95, y: p.y - 28 };
        })();

    const { id, created } = await addAttachedNode(graphId, {
      attachment: {
        type:     payload.targetType,
        targetId: payload.targetId,
        ...(payload.targetType === "node" ? { scope: "subtree" as const } : {}),
      },
      ...pos,
    });

    let summary = "";
    if (!created) {
      if (!hitNode) await moveNode(id, pos.x, pos.y);
      summary = "Already on this canvas — moved it here";
    } else if (payload.targetType !== "reflection") {
      summary = `Added "${payload.title}" — Unfold it for the full tree`;
    } else {
      summary = `Added "${payload.title}"`;
    }

    if (hitNode) {
      await addEdge(graphId, hitNode._id, id);
      const hitTitle = hitNode.label.trim() || "that node";
      toast(`Connected "${payload.title}" to ${hitTitle}`, { kind: "success" });
    } else {
      toast(summary, { kind: "success" });
    }
    onSelect(id);
  }, [graphId, nodeById, flow, onSelect, toast]);

  // ── quick actions (NodeToolbar + context menus) ──────────────────────

  const doDelete = useCallback((nodeId: string) => {
    void deleteNode(nodeId).then(ok => {
      if (!ok) toast("The root anchors this graph — it can't be deleted.", { kind: "error" });
      else onSelect(null);
    });
  }, [toast, onSelect]);

  const nodeActions = useMemo<GraphNodeActions>(() => ({
    onOpen:   href => navigate(href),
    onUnfold,
    onDelete: doDelete,
  }), [navigate, onUnfold, doDelete]);

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    if (menu.kind === "pane") {
      return [
        { label: "New node here", onClick: () => void addNodeAtScreen(menu.x, menu.y) },
        { label: "Tidy layout", hint: "from root", onClick: () => void tidy() },
        { label: libraryOpen ? "Close library" : "Open library", onClick: onToggleLibrary },
      ];
    }
    if (menu.kind === "node" && menu.id) {
      const flowNode = graphData.nodes.find(n => n.id === menu.id);
      if (!flowNode) return [];
      const d = flowNode.data as GraphNodeData;
      const items: MenuItem[] = [];
      if (d.attachment?.href && !d.attachment.stale) {
        items.push({
          label: d.attachment.type === "reflection" ? "Open reflection"
            : d.attachment.type === "chat" || d.subtitle === "chat" ? "Open chat" : "Open branch",
          onClick: () => navigate(d.attachment!.href),
        });
      }
      if (d.attachment?.unfoldable) {
        items.push({ label: "Unfold tree", hint: "prunable", onClick: () => onUnfold(menu.id!) });
      }
      items.push({ label: "Edit in panel", onClick: () => onSelect(menu.id!) });
      items.push({ label: "Disconnect all", onClick: () => void disconnectNode(menu.id!) });
      if (d.kind !== "root") {
        items.push({ label: "Delete node", danger: true, onClick: () => doDelete(menu.id!) });
      }
      return items;
    }
    if (menu.kind === "edge" && menu.id) {
      const edge = graphEdges.find(e => e._id === menu.id);
      return [
        {
          label: edge?.label ? "Edit label" : "Add label",
          onClick: () => setEdgeDraft({
            edgeId: menu.id!, x: menu.x, y: menu.y, value: edge?.label ?? "",
          }),
        },
        { label: "Delete connection", danger: true, onClick: () => void deleteEdge(menu.id!) },
      ];
    }
    return [];
  }, [menu, graphData.nodes, graphEdges, libraryOpen, onToggleLibrary,
      addNodeAtScreen, tidy, navigate, onUnfold, onSelect, doDelete]);

  const commitEdgeLabel = useCallback(() => {
    if (!edgeDraft) return;
    void updateEdge(edgeDraft.edgeId, { label: edgeDraft.value });
    setEdgeDraft(null);
  }, [edgeDraft]);

  const onlyRootSoFar = graphNodes.length === 1 && graphEdges.length === 0;

  return (
    <div
      className="tw:absolute tw:inset-0"
      onDoubleClick={e => {
        const t = e.target as HTMLElement;
        if (!t.closest(".react-flow__pane")) return;
        void addNodeAtScreen(e.clientX, e.clientY);
      }}
      onDragOver={e => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={e => void onDrop(e)}
    >
      <GraphNodeActionsContext.Provider value={nodeActions}>
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
          connectionMode={ConnectionMode.Loose}
          onConnect={onConnect}
          onNodeClick={(_e, n) => onSelect(n.id)}
          onPaneClick={() => { onSelect(null); setMenu(null); }}
          onPaneContextMenu={e => {
            e.preventDefault();
            setMenu({ kind: "pane", x: e.clientX, y: e.clientY });
          }}
          onNodeContextMenu={(e, n) => {
            e.preventDefault();
            setMenu({ kind: "node", x: e.clientX, y: e.clientY, id: n.id });
          }}
          onEdgeContextMenu={(e, edge) => {
            e.preventDefault();
            setMenu({ kind: "edge", x: e.clientX, y: e.clientY, id: edge.id });
          }}
          onEdgeDoubleClick={(e, edge) => {
            e.preventDefault();
            const current = graphEdges.find(x => x._id === edge.id);
            setEdgeDraft({ edgeId: edge.id, x: e.clientX, y: e.clientY, value: current?.label ?? "" });
          }}
          onNodeDragStart={() => { draggingRef.current = true; }}
          onNodeDragStop={(_e, node, draggedNodes) => {
            draggingRef.current = false;
            const moved = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node];
            void moveNodes(moved.map(n => ({ id: n.id, x: n.position.x, y: n.position.y })));
          }}
          onNodesDelete={deleted => {
            for (const n of deleted) {
              if ((n.data as GraphNodeData).kind === "root") continue;  // belt & braces — root is deletable:false
              void deleteNode(n.id);
            }
            onSelect(null);
          }}
          onEdgesDelete={deleted => {
            for (const e of deleted) void deleteEdge(e.id);
          }}
          connectionLineStyle={{ stroke: "var(--lilac)", strokeWidth: 2 }}
          style={{ background: "transparent" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} color="var(--line)" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={n => {
              const d = n.data as GraphNodeData;
              if (d.kind === "root") return mini.accents.coral;
              return d.attachment ? mini.stroke : (mini.accents[d.color] ?? mini.stroke);
            }}
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
                  void addNodeAtScreen(r ? r.left + r.width / 2 : window.innerWidth / 2, r ? r.top + r.height / 2 : window.innerHeight / 2);
                }}
              >
                + Node
              </button>
              <button
                className="tw:bg-bg-3 tw:text-ink tw:py-2 tw:px-3.5 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:shadow-1 tw:inline-flex tw:items-center tw:gap-1.5 tw:hover:border-ink-3"
                onClick={() => void tidy()}
                title="Re-arrange everything as a tree below the root"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="3" r="1.7" stroke="currentColor" strokeWidth="1.4" />
                  <circle cx="3.5" cy="13" r="1.7" stroke="currentColor" strokeWidth="1.4" />
                  <circle cx="12.5" cy="13" r="1.7" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M8 4.8 V8 M8 8 L3.5 11.2 M8 8 L12.5 11.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Tidy
              </button>
            </div>
          </Panel>
          {onlyRootSoFar && (
            <Panel position="top-center">
              <div className="tw:mt-16 tw:py-2.5 tw:px-4 tw:rounded-[999px] tw:bg-bg-2 tw:border tw:border-line tw:text-[13px] tw:text-ink-2 tw:shadow-1 tw:text-center">
                Open the Library and drag chats in — each drop is one node,
                connected to whatever you drop it on. Double-click for a
                blank node.
              </div>
            </Panel>
          )}
        </ReactFlow>
      </GraphNodeActionsContext.Provider>

      {menu && (
        <GraphContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {edgeDraft && (
        <div className="tw:fixed tw:inset-0 tw:z-[180]" onClick={commitEdgeLabel}>
          <input
            className="tw:fixed tw:w-[180px] tw:py-1.5 tw:px-2.5 tw:bg-bg-3 tw:border tw:border-lilac tw:rounded-[8px] tw:text-[12.5px] tw:text-ink tw:shadow-2 tw:outline-none"
            style={{ left: Math.min(edgeDraft.x, window.innerWidth - 200), top: edgeDraft.y }}
            value={edgeDraft.value}
            autoFocus
            placeholder="Label this connection…"
            spellCheck={false}
            onClick={e => e.stopPropagation()}
            onChange={e => setEdgeDraft({ ...edgeDraft, value: e.target.value })}
            onKeyDown={e => {
              if (e.key === "Enter")  { e.preventDefault(); commitEdgeLabel(); }
              if (e.key === "Escape") { e.preventDefault(); setEdgeDraft(null); }
            }}
          />
        </div>
      )}
    </div>
  );
}

export default GraphCanvas;
