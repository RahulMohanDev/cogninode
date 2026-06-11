// src/components/graph/AddToGraphDialog.tsx
// "Add to knowledge graph" — attach the current chat (TopBar) or a
// reflection (Reflections page) into a graph: pick a graph (or create
// one — that names its root), pick the node to wire it under (root by
// default, or create a fresh node named after your text / the target's
// title), done. Toasts confirm; opening the graph after is one click away.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "../../lib/db";
import {
  attachTargetToNode, createGraph, createNode, nextNodePosition,
} from "../../lib/knowledge";
import { useModalBehavior } from "../../hooks/useModalStack";
import { useToast } from "../ui/Toast";

export interface AddToGraphTarget {
  type:  "chat" | "reflection";
  id:    string;
  title: string;
}

export interface AddToGraphDialogProps {
  open:    boolean;
  target:  AddToGraphTarget | null;
  onClose: () => void;
}

export function AddToGraphDialog({ open, target, onClose }: AddToGraphDialogProps) {
  const toast = useToast();
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalBehavior(open, onClose, panelRef);

  const graphs = useLiveQuery(
    () => db.graphs.orderBy("updatedAt").reverse().toArray(),
    [],
  );

  const [graphId, setGraphId] = useState("");
  const [newGraphName, setNewGraphName] = useState("");
  const [creatingGraph, setCreatingGraph] = useState(false);
  const [nodeQuery, setNodeQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset per open; default to the most recent graph.
  useEffect(() => {
    if (!open) return;
    setGraphId("");
    setNewGraphName("");
    setCreatingGraph(false);
    setNodeQuery("");
    setBusy(false);
  }, [open]);
  useEffect(() => {
    if (!open || graphId || !graphs) return;
    if (graphs.length > 0) setGraphId(graphs[0]!._id);
    else setCreatingGraph(true);
  }, [open, graphId, graphs]);

  const graphNodes = useLiveQuery(
    () => (graphId ? db.graphNodes.where("graphId").equals(graphId).toArray() : []),
    [graphId],
    [],
  );

  // Only nameable anchors make sense to wire under: the root plus every
  // labeled node. (Label-less attached cards derive their titles — odd
  // targets for a picker.)
  const candidates = useMemo(
    () => graphNodes.filter(n => n.kind === "root" || n.label.trim()),
    [graphNodes],
  );

  const suggestions = useMemo(() => {
    const needle = nodeQuery.trim().toLowerCase();
    const base = needle
      ? candidates.filter(n => n.label.toLowerCase().includes(needle))
      : candidates;
    return [...base]
      .sort((a, b) =>
        (a.kind === "root" ? -1 : 0) - (b.kind === "root" ? -1 : 0) ||
        b.updatedAt - a.updatedAt)
      .slice(0, 6);
  }, [candidates, nodeQuery]);

  if (!open || !target) return null;

  const graphName = graphs?.find(g => g._id === graphId)?.name ?? "";

  const finish = (nodeLabel: string): void => {
    toast(`Attached to ${graphName || "graph"} › ${nodeLabel}`, { kind: "success" });
    onClose();
  };

  const attachExisting = async (nodeId: string, label: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await attachTargetToNode({
        graphId, nodeId,
        attachment: { type: target.type, targetId: target.id },
      });
      finish(label);
    } catch (err) {
      toast(`Couldn't attach: ${(err as Error).message}`, { kind: "error" });
      setBusy(false);
    }
  };

  const createAndAttach = async (): Promise<void> => {
    if (busy || !graphId) return;
    const label = nodeQuery.trim() || target.title.slice(0, 60) || "New node";
    setBusy(true);
    try {
      const pos = nextNodePosition(graphNodes.length);
      const nodeId = await createNode(graphId, { label, ...pos });
      await attachTargetToNode({
        graphId, nodeId,
        attachment: { type: target.type, targetId: target.id },
      });
      finish(label);
    } catch (err) {
      toast(`Couldn't attach: ${(err as Error).message}`, { kind: "error" });
      setBusy(false);
    }
  };

  const doCreateGraph = async (): Promise<void> => {
    const id = await createGraph(newGraphName.trim() || "My brain");
    setGraphId(id);
    setCreatingGraph(false);
    setNewGraphName("");
  };

  const exactMatch = suggestions.some(
    n => n.label.toLowerCase() === nodeQuery.trim().toLowerCase() && nodeQuery.trim() !== "",
  );

  return (
    <div
      className="tw:fixed tw:inset-0 tw:bg-[color-mix(in_oklab,var(--ink)_30%,transparent)] tw:dark:bg-[var(--veil-black-60)] tw:backdrop-blur-[8px] tw:grid tw:[place-items:start_center] tw:pt-[14vh] tw:z-[200] tw:animate-[fadeIn_0.14s_ease-out]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add to knowledge graph"
        className="tw:w-[min(480px,92vw)] tw:bg-bg-3 tw:border tw:border-line tw:rounded-[16px] tw:shadow-3 tw:overflow-hidden tw:animate-[popUp_0.18s_cubic-bezier(0.34,1.56,0.64,1)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="tw:flex tw:items-center tw:gap-2.5 tw:py-3.5 tw:px-[18px] tw:border-b tw:border-line">
          <svg className="tw:text-teal tw:flex-none" width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="4" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="12.5" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="6.5" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.6 5 L11 6 M5 5.7 L6.2 10.8 M7.9 11.7 L11.3 7.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <h2 className="tw:flex-1 tw:m-0 tw:font-display tw:font-semibold tw:text-[17px] tw:tracking-[-0.015em] tw:text-ink">Add to knowledge graph</h2>
          <button
            className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:hover:bg-bg-2 tw:hover:text-ink"
            onClick={onClose}
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="tw:p-[18px] tw:flex tw:flex-col tw:gap-3.5">
          <div className="tw:flex tw:items-center tw:gap-2 tw:py-2 tw:px-3 tw:rounded-app-sm tw:bg-bg tw:border tw:border-line-2 tw:text-[13px] tw:text-ink tw:min-w-0">
            <span className="tw:font-mono tw:text-[9px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3 tw:flex-none">{target.type}</span>
            <span className="tw:truncate">{target.title || "Untitled"}</span>
          </div>

          <div className="tw:flex tw:flex-col tw:gap-1">
            <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">Graph</label>
            {creatingGraph ? (
              <div className="tw:flex tw:gap-2">
                <input
                  className="tw:flex-1 tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[13px] tw:outline-none tw:bg-bg-3 tw:text-ink tw:focus:border-teal"
                  value={newGraphName}
                  onChange={e => setNewGraphName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void doCreateGraph(); }}
                  placeholder="e.g. Programming"
                  autoFocus
                  spellCheck={false}
                />
                <button
                  className="tw:bg-teal tw:text-white tw:py-2 tw:px-3.5 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:hover:opacity-90"
                  onClick={() => void doCreateGraph()}
                >
                  Create
                </button>
                {(graphs?.length ?? 0) > 0 && (
                  <button
                    className="tw:py-2 tw:px-2 tw:text-[13px] tw:text-ink-3 tw:hover:text-ink"
                    onClick={() => setCreatingGraph(false)}
                  >
                    cancel
                  </button>
                )}
              </div>
            ) : (
              <div className="tw:flex tw:gap-2">
                <select
                  className="tw:flex-1 tw:py-2 tw:px-2.5 tw:border tw:border-line tw:rounded-app-sm tw:text-[13px] tw:outline-none tw:bg-bg-3 tw:text-ink tw:focus:border-teal"
                  value={graphId}
                  onChange={e => setGraphId(e.target.value)}
                >
                  {graphs?.map(g => (
                    <option key={g._id} value={g._id}>{g.name}</option>
                  ))}
                </select>
                <button
                  className="tw:py-2 tw:px-3 tw:rounded-app-sm tw:text-[13px] tw:border tw:border-line tw:text-ink-2 tw:bg-bg-3 tw:hover:border-ink-3 tw:hover:text-ink"
                  onClick={() => setCreatingGraph(true)}
                  title="Create a new graph"
                >
                  + New
                </button>
              </div>
            )}
          </div>

          {graphId && !creatingGraph && (
            <div className="tw:flex tw:flex-col tw:gap-1">
              <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">Wire under</label>
              <input
                className="tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[13px] tw:outline-none tw:bg-bg-3 tw:text-ink tw:focus:border-teal"
                value={nodeQuery}
                onChange={e => setNodeQuery(e.target.value)}
                placeholder="Find or create a node…"
                autoFocus
                spellCheck={false}
              />
              <div className="tw:flex tw:flex-col tw:gap-0.5 tw:mt-0.5">
                {suggestions.map(n => (
                  <button
                    key={n._id}
                    className="tw:flex tw:items-center tw:gap-2 tw:text-left tw:py-1.5 tw:px-2.5 tw:rounded-[7px] tw:text-[13px] tw:text-ink tw:hover:bg-bg-2 tw:disabled:opacity-50"
                    onClick={() => void attachExisting(n._id, n.label)}
                    disabled={busy}
                  >
                    <span className={`tw:w-2 tw:h-2 tw:rounded-[50%] tw:flex-none ${
                      n.color === "coral" ? "tw:bg-coral" : n.color === "teal" ? "tw:bg-teal" : n.color === "lilac" ? "tw:bg-lilac" : "tw:bg-butter"
                    }`} />
                    <span className="tw:truncate">{n.label}</span>
                    {n.kind === "root" && (
                      <span className="tw:font-mono tw:text-[9px] tw:tracking-[0.1em] tw:uppercase tw:text-coral tw:flex-none">root</span>
                    )}
                  </button>
                ))}
                {!exactMatch && (
                  <button
                    className="tw:flex tw:items-center tw:gap-2 tw:text-left tw:py-1.5 tw:px-2.5 tw:rounded-[7px] tw:text-[13px] tw:text-ink-2 tw:hover:bg-bg-2 tw:hover:text-ink tw:disabled:opacity-50"
                    onClick={() => void createAndAttach()}
                    disabled={busy}
                  >
                    <span className="tw:w-4 tw:h-4 tw:grid tw:place-items-center tw:rounded-[50%] tw:border tw:border-dashed tw:border-line tw:text-[10px] tw:flex-none">+</span>
                    <span className="tw:truncate">
                      Create "{nodeQuery.trim() || target.title.slice(0, 40) || "New node"}"
                    </span>
                  </button>
                )}
                {suggestions.length === 0 && exactMatch === false && candidates.length > 0 && nodeQuery.trim() !== "" && (
                  <div className="tw:text-[12px] tw:text-ink-3 tw:px-2.5 tw:py-1">No matching nodes.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AddToGraphDialog;
