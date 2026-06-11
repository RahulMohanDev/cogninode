// src/components/graph/NodePanel.tsx
// The one side panel for every graph node (root, plain, or attached) —
// replaces the old ConceptPanel/SourcePanel split. Label, color, and
// notes always; the attachment block (open / scope / unfold / detach)
// appears when the node holds data; connections + attach-pickers always;
// delete for everything except the root.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type {
  Chat, GraphEdge, GraphNode, GraphNodeColor, Reflection,
} from "../../lib/db";
import {
  GRAPH_NODE_COLORS,
  attachTargetToNode, deleteEdge, deleteNode, detachNode,
  setAttachmentScope, updateNode,
} from "../../lib/knowledge";
import { displayTitle, type SourceResolvers } from "../../lib/graphFlow";
import { useToast } from "../ui/Toast";

const COLOR_BG: Record<GraphNodeColor, string> = {
  coral: "tw:bg-coral", teal: "tw:bg-teal", lilac: "tw:bg-lilac", butter: "tw:bg-butter",
};

export interface NodePanelProps {
  graphId:      string;
  node:         GraphNode;
  edges:        GraphEdge[];
  allNodes:     GraphNode[];
  resolvers:    SourceResolvers;
  chats:        Chat[];          // dock chats already filtered out upstream
  reflections:  Reflection[];
  /** New cards an Unfold would add; 0 hides the button. */
  unfoldCount:  number;
  onUnfold:     () => void;
  onSelectNode: (id: string) => void;
  onClose:      () => void;
}

export function NodePanel({
  graphId, node, edges, allNodes, resolvers, chats, reflections,
  unfoldCount, onUnfold, onSelectNode, onClose,
}: NodePanelProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const [label, setLabel] = useState(node.label);
  const [notes, setNotes] = useState(node.notes);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const display = displayTitle(node, resolvers);
  const isRoot  = node.kind === "root";
  const a       = node.attachment;

  const headerLabel = isRoot ? "Root"
    : !a ? "Node"
    : display.subtitle === "chat" ? "Chat node"
    : display.subtitle.startsWith("branch") ? "Branch node"
    : "Reflection node";

  const commitLabel = (): void => {
    const next = label.trim();
    if (next === node.label) return;
    // Attached nodes may clear their label (display re-derives from the
    // attachment); plain nodes and the root keep a non-empty one.
    if (!next && (!a || isRoot)) {
      setLabel(node.label);
      return;
    }
    void updateNode(node._id, { label: next });
  };

  // Targets already wired to this node — keeps the pickers free of dupes.
  const connectedTargetIds = useMemo(() => {
    const nodeById = new Map(allNodes.map(n => [n._id, n]));
    const out = new Set<string>();
    for (const e of edges) {
      const otherId = e.source === node._id ? e.target : e.target === node._id ? e.source : null;
      if (!otherId) continue;
      const other = nodeById.get(otherId);
      if (other?.attachment) out.add(other.attachment.targetId);
    }
    if (a) out.add(a.targetId);
    return out;
  }, [edges, node._id, allNodes, a]);

  const attach = (type: "chat" | "reflection") => (targetId: string): void => {
    void attachTargetToNode({ graphId, nodeId: node._id, attachment: { type, targetId } })
      .catch(err => toast(`Couldn't attach: ${(err as Error).message}`, { kind: "error" }));
  };

  return (
    <div className="tw:w-[320px] tw:flex-none tw:border-l tw:border-line tw:bg-bg tw:flex tw:flex-col tw:overflow-y-auto tw:[scrollbar-width:thin] tw:[scrollbar-color:var(--line)_transparent]">
      <PanelHeader label={headerLabel} onClose={onClose} />

      <div className="tw:p-4 tw:flex tw:flex-col tw:gap-4">
        <div className="tw:flex tw:flex-col tw:gap-1">
          <label htmlFor="node-panel-name" className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">
            {isRoot ? "Name — also the graph's name" : "Name"}
          </label>
          <input
            id="node-panel-name"
            className="tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:outline-none tw:bg-bg-3 tw:text-ink tw:focus:border-lilac tw:placeholder:text-ink-4"
            value={label}
            onChange={e => setLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder={a ? display.title : "Name this node…"}
            spellCheck={false}
          />
        </div>

        <div className="tw:flex tw:flex-col tw:gap-1.5">
          <span className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">Color</span>
          <div className="tw:flex tw:gap-2">
            {GRAPH_NODE_COLORS.map(c => (
              <button
                key={c}
                className={`tw:w-[26px] tw:h-[26px] tw:rounded-[50%] ${COLOR_BG[c]} ${node.color === c ? "tw:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_30%,transparent)]" : "tw:opacity-75 tw:hover:opacity-100"}`}
                onClick={() => void updateNode(node._id, { color: c })}
                title={c}
                aria-label={`Color ${c}`}
                aria-pressed={node.color === c}
              />
            ))}
          </div>
        </div>

        <div className="tw:flex tw:flex-col tw:gap-1">
          <label htmlFor="node-panel-notes" className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">Notes</label>
          <textarea
            id="node-panel-notes"
            className="tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[13px] tw:leading-[1.5] tw:outline-none tw:bg-bg-3 tw:text-ink tw:focus:border-lilac tw:resize-y tw:min-h-[72px]"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => { if (notes !== node.notes) void updateNode(node._id, { notes }); }}
            placeholder={isRoot
              ? "What is this graph about? The dock chat reads this first."
              : "What is this node about? Notes are part of the corpus."}
            rows={3}
          />
        </div>

        {a && (
          <div className="tw:flex tw:flex-col tw:gap-2 tw:p-3 tw:rounded-[10px] tw:border tw:border-line-2 tw:bg-bg-3">
            <div className="tw:font-mono tw:text-[10px] tw:tracking-[0.1em] tw:uppercase tw:text-ink-3">{display.subtitle}</div>
            <div className={`tw:font-display tw:font-semibold tw:text-[15px] tw:tracking-[-0.01em] tw:leading-[1.25] ${display.stale ? "tw:text-ink-3 tw:line-through" : "tw:text-ink"}`}>
              {display.title}
            </div>

            {display.stale ? (
              <p className="tw:m-0 tw:text-[12px] tw:text-coral">
                The underlying {a.type === "node" ? "branch" : a.type} was
                deleted — detach to keep the node, or delete it.
              </p>
            ) : (
              <>
                {a.type === "node" && (
                  <div className="tw:flex tw:items-center tw:gap-1.5">
                    <span className="tw:text-[11px] tw:text-ink-3 tw:flex-1">Data covers</span>
                    {(["single", "subtree"] as const).map(s => (
                      <button
                        key={s}
                        className={`tw:py-1 tw:px-2 tw:rounded-[6px] tw:text-[11px] tw:font-medium tw:border ${(a.scope ?? "subtree") === s ? "tw:bg-teal tw:text-white tw:border-teal" : "tw:bg-bg tw:text-ink-2 tw:border-line tw:hover:border-ink-3"}`}
                        onClick={() => void setAttachmentScope(node._id, s)}
                        title={s === "single" ? "Only this branch's own messages" : "This branch plus everything under it"}
                      >
                        {s === "single" ? "this branch" : "whole subtree"}
                      </button>
                    ))}
                  </div>
                )}

                {display.href && (
                  <button
                    className="tw:w-full tw:py-2 tw:px-3 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:text-ink tw:bg-bg tw:hover:border-ink-3"
                    onClick={() => navigate(display.href)}
                  >
                    Open {display.subtitle === "chat" ? "chat" : a.type === "node" ? "branch" : "reflection"} →
                  </button>
                )}
                {unfoldCount > 0 && (
                  <button
                    className="tw:w-full tw:py-2 tw:px-3 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:text-ink tw:bg-bg tw:hover:border-ink-3"
                    onClick={onUnfold}
                    title="Spread this tree's branches onto the canvas as cards you can prune"
                  >
                    Unfold {unfoldCount} branch{unfoldCount === 1 ? "" : "es"}
                  </button>
                )}
              </>
            )}

            <button
              className="tw:w-full tw:py-1.5 tw:px-3 tw:rounded-app-sm tw:text-[12px] tw:border tw:border-dashed tw:border-line tw:text-ink-3 tw:bg-transparent tw:hover:text-ink tw:hover:border-ink-3"
              onClick={() => void detachNode(node._id, display.title)}
              title="Keep the node (and its connections) but drop the attached data"
            >
              Detach data
            </button>
          </div>
        )}

        <ConnectionsList
          nodeId={node._id}
          edges={edges}
          allNodes={allNodes}
          resolvers={resolvers}
          onSelectNode={onSelectNode}
        />

        <div className="tw:flex tw:flex-col tw:gap-1.5">
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
          {isRoot ? (
            <p className="tw:m-0 tw:text-[11.5px] tw:text-ink-4">
              The root anchors this graph — retrieval starts here. It can't
              be deleted.
            </p>
          ) : confirming ? (
            <div className="tw:flex tw:items-center tw:gap-1.5 tw:px-2.5 tw:py-1.5 tw:bg-[color-mix(in_oklab,var(--coral)_12%,var(--bg-3))] tw:border tw:border-[color-mix(in_oklab,var(--coral)_30%,var(--line))] tw:rounded-[8px] tw:text-[12px] tw:text-ink">
              <span className="tw:flex-1">Delete this node?</span>
              <button className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:text-coral tw:font-semibold tw:hover:bg-coral tw:hover:text-white" onClick={() => { void deleteNode(node._id); onClose(); }}>yes</button>
              <span className="tw:text-ink-4">·</span>
              <button className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink" onClick={() => setConfirming(false)}>cancel</button>
            </div>
          ) : (
            <button
              className="tw:w-full tw:py-2 tw:px-3 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-coral tw:text-coral tw:bg-bg tw:hover:bg-coral-tint"
              onClick={() => setConfirming(true)}
              title="Removes the node and its connections — the underlying chat/reflection is untouched"
            >
              Delete node
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── shared bits ────────────────────────────────────────────────────────

// One symmetric connections list for EVERY node — each row is whatever
// sits at the other end of an edge: click selects it on the canvas, ↗
// opens the underlying chat/branch/reflection, ✕ cuts just that edge.
function ConnectionsList({
  nodeId, edges, allNodes, resolvers, onSelectNode,
}: {
  nodeId:       string;
  edges:        GraphEdge[];
  allNodes:     GraphNode[];
  resolvers:    SourceResolvers;
  onSelectNode: (id: string) => void;
}) {
  const navigate = useNavigate();
  const nodeById = useMemo(() => new Map(allNodes.map(n => [n._id, n])), [allNodes]);

  const rows = useMemo(() => {
    const out: Array<{
      edgeId:  string;
      otherId: string;
      title:   string;
      chip:    string;
      dot?:    string;       // accent class for plain nodes / root
      href?:   string;
      lineage: boolean;
      edgeLabel?: string;
    }> = [];
    for (const e of edges) {
      const otherId = e.source === nodeId ? e.target : e.target === nodeId ? e.source : null;
      if (!otherId) continue;
      const other = nodeById.get(otherId);
      if (!other) continue;
      const d = displayTitle(other, resolvers);
      const chip = other.kind === "root" ? "root"
        : !other.attachment ? "node"
        : d.subtitle === "chat" ? "chat"
        : other.attachment.type === "node" ? "branch"
        : "reflection";
      out.push({
        edgeId: e._id, otherId, title: d.title, chip,
        ...(other.attachment ? {} : { dot: COLOR_BG[other.color] ?? "" }),
        ...(d.href ? { href: d.href } : {}),
        lineage: e.kind === "lineage",
        ...(e.label ? { edgeLabel: e.label } : {}),
      });
    }
    return out;
  }, [edges, nodeId, nodeById, resolvers]);

  return (
    <div className="tw:flex tw:flex-col tw:gap-1.5">
      <span className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">
        Connections{rows.length > 0 ? ` · ${rows.length}` : ""}
      </span>
      {rows.length === 0 && (
        <p className="tw:m-0 tw:text-[12px] tw:text-ink-4">
          No connections yet — drag from a handle to any other node.
        </p>
      )}
      {rows.map(row => (
        <div
          key={row.edgeId}
          className="tw:group/att tw:flex tw:items-center tw:gap-1.5 tw:py-1.5 tw:px-2 tw:rounded-[8px] tw:border tw:border-line-2 tw:bg-bg-3 tw:text-[12.5px] tw:text-ink tw:min-w-0"
          title={row.lineage ? "From the chat's tree structure" : row.edgeLabel}
        >
          {row.dot
            ? <span className={`tw:w-2 tw:h-2 tw:rounded-[50%] tw:flex-none ${row.dot}`} />
            : <span className="tw:font-mono tw:text-[8.5px] tw:tracking-[0.08em] tw:uppercase tw:text-ink-4 tw:flex-none">{row.chip}</span>}
          <button
            className="tw:flex-1 tw:min-w-0 tw:truncate tw:text-left tw:p-0 tw:hover:text-coral"
            onClick={() => onSelectNode(row.otherId)}
            title={`Select "${row.title}" on the canvas`}
          >
            {row.title}
            {row.edgeLabel && (
              <span className="tw:text-ink-4 tw:text-[11px]"> · {row.edgeLabel}</span>
            )}
          </button>
          {row.href && (
            <button
              className="tw:w-[20px] tw:h-[20px] tw:grid tw:place-items-center tw:rounded-[5px] tw:flex-none tw:text-ink-4 tw:opacity-0 tw:group-hover/att:opacity-100 tw:hover:bg-bg-2 tw:hover:text-ink"
              onClick={() => navigate(row.href!)}
              title="Open"
              aria-label={`Open ${row.title}`}
            >
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                <path d="M6 3 H13 V10 M13 3 L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button
            className="tw:w-[20px] tw:h-[20px] tw:grid tw:place-items-center tw:rounded-[5px] tw:flex-none tw:text-ink-4 tw:opacity-0 tw:group-hover/att:opacity-100 tw:hover:bg-[color-mix(in_oklab,var(--coral)_18%,transparent)] tw:hover:text-coral"
            onClick={() => void deleteEdge(row.edgeId)}
            title="Disconnect (both nodes stay on the canvas)"
            aria-label={`Disconnect ${row.title}`}
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

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
    <div className="tw:relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <input
        className="tw:w-full tw:py-1.5 tw:px-2.5 tw:border tw:border-dashed tw:border-line tw:rounded-app-sm tw:text-[12.5px] tw:outline-none tw:bg-bg tw:text-ink tw:focus:border-ink-3 tw:placeholder:text-ink-4"
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
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

export default NodePanel;
