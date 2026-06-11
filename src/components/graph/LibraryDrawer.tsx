// src/components/graph/LibraryDrawer.tsx
// The draggable source library: every chat with its full branch tree,
// plus reflections. This is where granularity lives — drag a whole chat,
// a single branch (it stands for its subtree), or a reflection. Each drop
// lands as ONE node on the canvas; Unfold expands trees on demand.
// Graph-owned dock chats never appear here (a graph can't feed on its
// own answers).

import { useMemo, useState } from "react";
import type { Chat, Node as DbNode, Reflection } from "../../lib/db";
import { DRAG_MIME, type DragPayload } from "../../lib/graphFlow";
import { buildTree, type TreeNode } from "../../lib/path";

/** Render a small card as the drag image so the cursor carries something
 *  that looks like what will land on the canvas. */
function startDrag(e: React.DragEvent, payload: DragPayload): void {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copy";

  const ghost = document.createElement("div");
  ghost.textContent = payload.title;
  ghost.className =
    "tw:fixed tw:top-[-1000px] tw:left-[-1000px] tw:max-w-[200px] tw:truncate " +
    "tw:border-2 tw:border-teal tw:rounded-[12px] tw:bg-bg-3 tw:py-2 tw:px-3 " +
    "tw:text-[13px] tw:font-medium tw:text-ink tw:shadow-2";
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 16, 16);
  setTimeout(() => ghost.remove(), 0);
}

export function LibraryDrawer({
  chats, dbNodes, reflections, onClose,
}: {
  chats:       Chat[];
  dbNodes:     DbNode[];
  reflections: Reflection[];
  onClose:     () => void;
}) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Dock chats out; their nodes never render (rows come from visible chats).
  const sourceChats = useMemo(() => chats.filter(c => !c.graphId), [chats]);

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
    ? sourceChats.filter(c => c.title.toLowerCase().includes(needle))
    : sourceChats;
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
          Drag anything in — each drop is one node holding that data.
          Right-click a node → Unfold when you want its whole tree.
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
                  title="Drag this branch in — its node covers the whole subtree"
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
          <div className="tw:py-5 tw:px-3 tw:text-ink-3 tw:text-[12px] tw:text-center">{needle ? <>Nothing matches "{q}".</> : <>No chats or reflections yet — start a chat to add sources.</>}</div>
        )}
      </div>
    </div>
  );
}

export default LibraryDrawer;
