// src/pages/Chats.tsx
// "Grove" landing page: lists all chats as cards with a tiny tree thumb,
// plus a starter-chip row that creates a chat seeded with a prompt.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";

import { db, createChat, deleteChat, type Chat, type Node } from "../lib/db";
import { formatCost } from "../lib/cost";
import { buildTree, layoutTree } from "../lib/path";
import { Sidebar } from "../components/chat/Sidebar";
import { SettingsModal } from "../components/settings/SettingsModal";
import { useSettings } from "../hooks/useSettings";
import { useSettingsHotkey } from "../hooks/useSettingsHotkey";

interface Starter {
  label:  string;
  prompt: string;
  icon:   string;
}

const STARTERS: Starter[] = [
  { label: "Brainstorm a product name", prompt: "Help me brainstorm names for a new AI-powered ", icon: "💡" },
  { label: "Explain a concept simply",  prompt: "Explain ",                                       icon: "📖" },
  { label: "Write code",                prompt: "Write a ",                                       icon: "⌘" },
  { label: "Plan a trip",               prompt: "Help me plan a trip to ",                       icon: "✈" },
];

function formatCreated(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Chats() {
  const navigate = useNavigate();
  const { prefs } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ⌃, / ⌘, — advertised in the shortcuts sheet.
  useSettingsHotkey(() => setSettingsOpen(true));

  const chats = useLiveQuery(
    // Graph dock chats render only inside their graph's editor.
    () => db.chats.orderBy("updatedAt").reverse().filter(c => !c.graphId).toArray(),
    [],
  );

  async function startNewChat() {
    const id = await createChat();
    navigate(`/chat/${id}`);
  }

  async function startStarter(s: Starter) {
    const id = await createChat(s.label);
    navigate(`/chat/${id}?prefill=${encodeURIComponent(s.prompt)}`);
  }

  return (
    <div className={`tw:grid tw:h-dvh tw:w-screen tw:transition-[grid-template-columns] tw:duration-[220ms] tw:ease-[cubic-bezier(0.4,0,0.2,1)] tw:motion-reduce:transition-none ${prefs.sidebarCollapsed ? "tw:grid-cols-[60px_1fr]" : "tw:grid-cols-[268px_1fr]"}`}>
      <Sidebar activeChatId={null} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:h-full tw:bg-bg-3 tw:relative tw:overflow-hidden">
        <div className="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:pt-8 tw:px-10 tw:pb-20 tw:bg-bg-3 tw:dark:[background:radial-gradient(800px_400px_at_100%_-10%,color-mix(in_oklab,var(--coral)_6%,transparent),transparent_60%),radial-gradient(700px_400px_at_0%_100%,color-mix(in_oklab,var(--teal)_5%,transparent),transparent_60%),var(--bg-3)]">
          <div className="tw:max-w-[880px] tw:mx-auto tw:mt-0 tw:mb-9">
            <span className="tw:font-mono tw:text-[10px] tw:tracking-[0.14em] tw:uppercase tw:text-ink-3 tw:inline-flex tw:items-center tw:gap-2">
              <span className="tw:w-1.5 tw:h-1.5 tw:rounded-[50%] tw:bg-coral" />
              All chats
            </span>
            <h1 className="tw:font-display tw:font-semibold tw:text-[44px] tw:tracking-[-0.025em] tw:my-2 tw:mx-0 tw:leading-none">
              Your <em className="tw:font-serif tw:italic tw:text-coral tw:font-normal">grove</em>.
            </h1>
            <p className="tw:text-ink-2 tw:m-0 tw:max-w-[540px] tw:text-[16px]">
              Every chat is a tree of branched thoughts. Pick one to keep growing,
              or plant a new one.
            </p>
          </div>

          <div className="tw:max-w-[880px] tw:mx-auto">
            <div className="tw:flex tw:gap-2 tw:mb-3.5 tw:flex-wrap">
              {STARTERS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => { void startStarter(s); }}
                  className="tw:bg-bg-3 tw:text-ink tw:py-[9px] tw:px-3.5 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:border-ink-3"
                >
                  <span className="tw:text-[14px]">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] tw:gap-4">
              <div
                className="tw:border tw:border-line tw:rounded-[16px] tw:p-[18px] tw:cursor-pointer tw:transition-[border-color,transform] tw:duration-[120ms] tw:ease-[ease] tw:min-h-[180px] tw:relative tw:overflow-hidden tw:bg-bg-3 tw:border-dashed tw:grid tw:place-items-center tw:text-center tw:hover:border-ink-3 tw:hover:-translate-y-0.5"
                onClick={() => { void startNewChat(); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void startNewChat();
                  }
                }}
              >
                <div className="tw:w-11 tw:h-11 tw:grid tw:place-items-center tw:rounded-[50%] tw:bg-coral tw:text-white tw:text-[22px] tw:font-light tw:leading-none tw:mb-3">+</div>
                <div className="tw:font-display tw:font-semibold tw:text-[16px] tw:tracking-[-0.01em]">New chat</div>
                <div className="tw:text-[12px] tw:text-ink-3 tw:mt-1">⌃N · start a fresh tree</div>
              </div>

              {chats?.map((chat) => (
                <ChatCard
                  key={chat._id}
                  chat={chat}
                  onOpen={() => navigate(`/chat/${chat._id}`)}
                />
              ))}

              {chats && chats.length === 0 && (
                <div className="tw:col-span-full tw:text-ink-3 tw:text-[13px] tw:px-1 tw:py-3">
                  No chats yet. Press ⌃N or click the + card to start your first tree.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// ── Per-chat card ─────────────────────────────────────────────────────────

interface ChatCardProps {
  chat:   Chat;
  onOpen: () => void;
}

function ChatCard({ chat, onOpen }: ChatCardProps) {
  const nodeCount = useLiveQuery(
    () => db.nodes.where("chatId").equals(chat._id).count(),
    [chat._id],
    0,
  );

  const cost = useLiveQuery(
    async () => {
      const msgs = await db.messages.where("chatId").equals(chat._id).toArray();
      return msgs.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
    },
    [chat._id],
    0,
  );

  // Inline-confirm delete: a small trash icon shows on hover; clicking it
  // arms a pill that auto-reverts after 4s. No window.confirm.
  const [confirming, setConfirming] = useState(false);
  const revertRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (revertRef.current !== null) window.clearTimeout(revertRef.current);
    };
  }, []);

  const arm = (): void => {
    setConfirming(true);
    if (revertRef.current !== null) window.clearTimeout(revertRef.current);
    revertRef.current = window.setTimeout(() => {
      setConfirming(false);
      revertRef.current = null;
    }, 4000);
  };

  const cancel = (): void => {
    if (revertRef.current !== null) window.clearTimeout(revertRef.current);
    revertRef.current = null;
    setConfirming(false);
  };

  const doDelete = async (): Promise<void> => {
    cancel();
    await deleteChat(chat._id);
  };

  return (
    <div
      className="tw:group/card tw:bg-bg tw:border tw:border-line tw:rounded-[16px] tw:p-[18px] tw:cursor-pointer tw:transition-[border-color,transform] tw:duration-[120ms] tw:ease-[ease] tw:min-h-[180px] tw:relative tw:overflow-hidden tw:flex tw:flex-col tw:hover:border-ink-3 tw:hover:-translate-y-0.5"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <button
        className="tw:absolute tw:top-2.5 tw:right-2.5 tw:w-6 tw:h-6 tw:grid tw:place-items-center tw:rounded-[6px] tw:text-ink-3 tw:opacity-0 tw:transition-[opacity,background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:group-hover/card:opacity-90 tw:focus-visible:opacity-90 tw:hover:bg-[color-mix(in_oklab,var(--coral)_18%,transparent)] tw:hover:text-coral"
        title="Delete chat"
        aria-label="Delete chat"
        onClick={(e) => { e.stopPropagation(); arm(); }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 4 H13 M6 4 V3 a1 1 0 0 1 1 -1 h2 a1 1 0 0 1 1 1 V4 M5 4 v9 a1 1 0 0 0 1 1 h4 a1 1 0 0 0 1 -1 V4"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7 7 V11 M9 7 V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>

      <div className="tw:font-display tw:font-semibold tw:text-[19px] tw:tracking-[-0.015em] tw:leading-[1.15] tw:mb-2 tw:text-balance" title={chat.title}>{chat.title}</div>
      <div className="tw:font-mono tw:text-[11px] tw:text-ink-3 tw:mb-4 tw:flex tw:items-center tw:gap-2.5">
        <span>{formatCreated(chat.createdAt)}</span>
        <span style={{ opacity: 0.3 }}>·</span>
        <span>
          {nodeCount} {nodeCount === 1 ? "branch" : "branches"}
        </span>
        {cost > 0 && (
          <>
            <span style={{ opacity: 0.3 }}>·</span>
            <span>{formatCost(cost)}</span>
          </>
        )}
      </div>
      <div className="tw:flex-1 tw:relative tw:mt-auto">
        <MiniTreeThumb chatId={chat._id} />
      </div>

      {confirming && (
        <div
          className="tw:absolute tw:[inset:auto_10px_10px_10px] tw:flex tw:items-center tw:gap-1.5 tw:px-2.5 tw:py-[7px] tw:bg-[color-mix(in_oklab,var(--coral)_14%,var(--bg-3))] tw:border tw:border-[color-mix(in_oklab,var(--coral)_30%,var(--line))] tw:rounded-[8px] tw:text-[12px] tw:text-ink tw:shadow-1"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="tw:flex-1 tw:min-w-0">Delete this chat?</span>
          <button className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:transition-[background-color,color] tw:duration-100 tw:ease-[ease] tw:text-coral tw:font-semibold tw:hover:bg-coral tw:hover:text-white" onClick={() => { void doDelete(); }}>yes</button>
          <span className="tw:text-ink-4">·</span>
          <button className="tw:px-1.5 tw:py-0.5 tw:rounded-[5px] tw:transition-[background-color,color] tw:duration-100 tw:ease-[ease] tw:text-ink-3 tw:hover:bg-bg-2 tw:hover:text-ink" onClick={cancel}>cancel</button>
        </div>
      )}
    </div>
  );
}

// ── Tiny SVG tree visualization ───────────────────────────────────────────

const THUMB_W = 96;
const THUMB_H = 48;
const THUMB_PAD = 6;

interface MiniTreeThumbProps {
  chatId: string;
}

function MiniTreeThumb({ chatId }: MiniTreeThumbProps) {
  const nodesResult = useLiveQuery(
    () => db.nodes.where("chatId").equals(chatId).toArray(),
    [chatId],
  );
  const nodes: Node[] = nodesResult ?? [];

  if (nodes.length === 0) {
    return <svg width={THUMB_W} height={THUMB_H} aria-hidden="true" />;
  }

  const roots  = buildTree(nodes);
  const points = layoutTree(roots);
  if (points.length === 0) {
    return <svg width={THUMB_W} height={THUMB_H} aria-hidden="true" />;
  }

  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));

  const scaleX = maxX > 0 ? (THUMB_W - THUMB_PAD * 2) / maxX : 0;
  const scaleY = maxY > 0 ? (THUMB_H - THUMB_PAD * 2) / maxY : 0;

  const project = (x: number, y: number): { px: number; py: number } => ({
    px: maxX > 0
      ? THUMB_PAD + x * scaleX
      : THUMB_W / 2,
    py: maxY > 0
      ? THUMB_PAD + y * scaleY
      : THUMB_H / 2,
  });

  const pointById = new Map(points.map((p) => [p.nodeId, p]));

  // Visible cap so the thumb stays legible; spec asks for ~12–16 dots.
  const visiblePoints = [...points].sort((a, b) => a.depth - b.depth).slice(0, 18);
  const visibleIds = new Set(visiblePoints.map((p) => p.nodeId));

  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const n of nodes) {
    if (!n.parentId) continue;
    if (!visibleIds.has(n._id) || !visibleIds.has(n.parentId)) continue;
    const child  = pointById.get(n._id);
    const parent = pointById.get(n.parentId);
    if (!child || !parent) continue;
    const c = project(child.x,  child.y);
    const p = project(parent.x, parent.y);
    edges.push({ x1: p.px, y1: p.py, x2: c.px, y2: c.py });
  }

  return (
    <svg
      width={THUMB_W}
      height={THUMB_H}
      viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {edges.map((e, i) => (
        <line
          key={i}
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
          stroke="var(--line)"
          strokeWidth={1}
        />
      ))}
      {visiblePoints.map((p) => {
        const { px, py } = project(p.x, p.y);
        const isRoot = p.depth === 0;
        return (
          <circle
            key={p.nodeId}
            cx={px}
            cy={py}
            r={isRoot ? 2.4 : 1.8}
            fill={isRoot ? "var(--coral)" : "var(--ink-3)"}
          />
        );
      })}
    </svg>
  );
}
