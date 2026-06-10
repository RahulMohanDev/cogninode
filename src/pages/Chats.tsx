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

  const chats = useLiveQuery(
    () => db.chats.orderBy("updatedAt").reverse().toArray(),
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
    <div className={`shell ${prefs.sidebarCollapsed ? "collapsed" : ""}`}>
      <Sidebar activeChatId={null} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="main">
        <div className="page">
          <div className="page-head">
            <span className="eyebrow">
              <span className="dot" />
              All chats
            </span>
            <h1>
              Your <em>grove</em>.
            </h1>
            <p>
              Every chat is a tree of branched thoughts. Pick one to keep growing,
              or plant a new one.
            </p>
          </div>

          <div className="page-body">
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              {STARTERS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => { void startStarter(s); }}
                  className="btn-outline"
                  style={{ fontSize: 13, padding: "9px 14px" }}
                >
                  <span style={{ fontSize: 14 }}>{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="chats-grid">
              <div
                className="chat-card new"
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
                <div className="nc-plus">+</div>
                <div className="nc-title">New chat</div>
                <div className="nc-sub">⌃N · start a fresh tree</div>
              </div>

              {chats?.map((chat) => (
                <ChatCard
                  key={chat._id}
                  chat={chat}
                  onOpen={() => navigate(`/chat/${chat._id}`)}
                />
              ))}

              {chats && chats.length === 0 && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    color: "var(--ink-3)",
                    fontSize: 13,
                    padding: "12px 4px",
                  }}
                >
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
      className="chat-card has-delete"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <button
        className="cc-del"
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

      <div className="cc-title">{chat.title}</div>
      <div className="cc-meta">
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
      <div className="cc-tree">
        <MiniTreeThumb chatId={chat._id} />
      </div>

      {confirming && (
        <div
          className="cc-confirm"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="cp-label">Delete this chat?</span>
          <button className="cp-yes" onClick={() => { void doDelete(); }}>yes</button>
          <span className="cp-sep">·</span>
          <button className="cp-no" onClick={cancel}>cancel</button>
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
  const visiblePoints = points.slice(0, 18);
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
