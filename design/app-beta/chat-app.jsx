// chat-app.jsx — Main chat page controller. State + keyboard + reflections + branching.

const {
  Sidebar, Toast, Glyph, ThemeToggle,
  initStore, saveStore, newId, getModel, pathToRoot, childrenOf, costInPath, fmt,
  roughTokens, calculateCostUsd, formatCost, getApiKey, loadCustomModels,
  Message, Composer, SelectionPopup,
  QuickJump, TreeMap, ShortcutsPanel,
  SettingsModal,
} = window;

// Resolve a model id against built-ins OR user-added custom models.
const resolveModel = (id) =>
  getModel(id) || loadCustomModels().find(m => m.id === id) || getModel("flash");

// ---- Canned replies for the "live" fallback (seeded data app) ----
const CANNED_HEAD = [
  "Good question — here's the gist.\n\n",
  "Two threads worth pulling on:\n\n",
  "Short version first, then specifics.\n\n",
];
const CANNED_TAIL = [
  "\n\nWant me to drill into any of these?",
  "\n\nHappy to expand on any line.",
  "\n\nLet me know which thread to follow.",
];
const fakeReply = (prompt, model) => {
  const head = CANNED_HEAD[Math.floor(Math.random() * CANNED_HEAD.length)];
  const tail = CANNED_TAIL[Math.floor(Math.random() * CANNED_TAIL.length)];
  // Generate 3-4 plausible bullets riffing on the prompt's first noun-ish word
  const stem = prompt.replace(/^[^a-z]*/i, "").split(/[\s\?\.,]/)[0] || "this";
  const bullets = [
    `**${stem}** in the simplest framing — one decision, repeated.`,
    `Common trap — chasing complexity before the basics are honest.`,
    `The 80/20 — pick the two highest-leverage moves and skip the rest.`,
  ];
  return head + bullets.map(b => "• " + b).join("\n") + tail;
};

// Read URL params
const getParam = (k) => new URLSearchParams(window.location.search).get(k);

const PREF_KEY = "cogninode_prefs";
const loadPrefs = () => {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; }
};
const savePrefs = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} };

// ---- Empty state (chat with no messages yet) ----
const EmptyChat = ({ onSuggest }) => {
  const suggestions = [
    { label: "Brainstorm",  body: "Help me brainstorm names for a productivity app focused on deep work." },
    { label: "Explain",     body: "Explain how vector databases work, with a quick example." },
    { label: "Draft",       body: "Draft a kind decline to a meeting invite I don't have time for." },
    { label: "Debug",       body: "I'm getting 'Hydration mismatch' in Next.js — what could cause this?" },
  ];
  return (
    <div className="empty">
      <div className="empty-inner">
        <div className="empty-glyph">
          <Glyph size={36}/>
        </div>
        <h2>What are we <em>thinking</em> about?</h2>
        <p>Ask anything. When a reply sparks a tangent, select the text and branch off without losing context.</p>
        <div className="empty-suggest">
          {suggestions.map(s => (
            <button key={s.label} onClick={() => onSuggest(s.body)}>
              <span className="es-label">{s.label}</span>
              {s.body}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---- Main app ----
const ChatApp = () => {
  const [store, setStore] = React.useState(() => initStore());
  const [prefs, setPrefs] = React.useState(() => ({ branchMode: "follow", model: "sonnet", ...loadPrefs() }));

  // Active chat / node — from URL on first render
  const initialChatId = getParam("id") || store.chatOrder[0];
  const initialNodeId = getParam("node") || (store.chats[initialChatId]?.currentNodeId) || (store.chats[initialChatId]?.rootId);
  const [activeChatId, setActiveChatId] = React.useState(initialChatId);
  const [activeNodeId, setActiveNodeId] = React.useState(initialNodeId);

  // Composer state, keyed per node
  const [drafts, setDrafts] = React.useState(() => {
    const prefill = getParam("prefill");
    if (prefill && initialChatId && initialNodeId) {
      return { [`${initialChatId}:${initialNodeId}`]: { text: prefill, files: [], quote: null } };
    }
    return {};
  });
  const [thinking, setThinking] = React.useState(false);

  // Selection popup
  const [selectionState, setSelectionState] = React.useState(null);

  // Overlays
  const [showJump, setShowJump] = React.useState(false);
  const [showTree, setShowTree] = React.useState(false);
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [settingsFocusSection, setSettingsFocusSection] = React.useState(null);

  // Reflections mode (per chat)
  const [reflectMode, setReflectMode] = React.useState(false);

  // Toasts
  const [toast, setToast] = React.useState(null);

  const streamRef = React.useRef(null);

  const activeChat = activeChatId ? store.chats[activeChatId] : null;
  const activeNode = activeChat ? activeChat.nodes[activeNodeId] : null;
  const path = activeChat && activeNode ? pathToRoot(activeChat, activeNodeId) : [];
  const draftKey = activeChat ? `${activeChatId}:${activeNodeId}` : "";
  const draft = drafts[draftKey] || { text: "", files: [], quote: null };

  const persist = (next) => { setStore(next); saveStore(next); };

  // ---- Persist URL on navigation ----
  React.useEffect(() => {
    if (!activeChatId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("id", activeChatId);
    url.searchParams.set("node", activeNodeId);
    url.searchParams.delete("prefill");
    window.history.replaceState({}, "", url.toString());
  }, [activeChatId, activeNodeId]);

  // ---- Scroll to bottom when content changes ----
  React.useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [activeNodeId, activeChatId, thinking, activeNode?.messages.length]);

  // ---- Keyboard ----
  React.useEffect(() => {
    const onKey = (e) => {
      const inField = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)
        || document.activeElement?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      // ESC always closes overlays
      if (e.key === "Escape") {
        if (showSettings) { setShowSettings(false); return; }
        if (showTree) { setShowTree(false); return; }
        if (showJump) { setShowJump(false); return; }
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (selectionState) { setSelectionState(null); window.getSelection?.()?.removeAllRanges?.(); return; }
        if (reflectMode) { setReflectMode(false); return; }
      }

      if (!mod) return;

      const k = e.key.toLowerCase();
      if (k === "q") { e.preventDefault(); setShowJump(v => !v); }
      else if (k === "n") { e.preventDefault(); handleNewChat(); }
      else if (k === ",") { e.preventDefault(); setSettingsFocusSection(null); setShowSettings(v => !v); }
      else if (k === "t") { e.preventDefault(); if (activeChat) setShowTree(v => !v); }
      else if (k === "r") { e.preventDefault(); if (activeChat) setReflectMode(v => !v); }
      else if (k === "b" && selectionState) { e.preventDefault(); doBranch(selectionState.text); }
      else if (k === "arrowup") { e.preventDefault(); navTree("up"); }
      else if (k === "arrowdown") { e.preventDefault(); navTree("down"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showJump, showTree, showShortcuts, reflectMode, selectionState, activeChatId, activeNodeId, activeChat]);

  // ---- Selection detection inside assistant messages ----
  React.useEffect(() => {
    if (reflectMode) { setSelectionState(null); return; }
    const onUp = (e) => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.toString().trim().length < 3) {
          setSelectionState(null);
          return;
        }
        // Only when inside an assistant m-body
        let node = sel.anchorNode;
        while (node && node.nodeType !== 1) node = node.parentNode;
        const body = node?.closest?.(".msg.assistant .m-body");
        if (!body) { setSelectionState(null); return; }
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSelectionState({
          text: sel.toString().trim(),
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        });
      }, 1);
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
    };
  }, [reflectMode]);

  // ---- Actions ----
  const handleNewChat = () => {
    const cid = newId("c");
    const rid = newId("n");
    const chat = {
      id: cid, title: "New chat",
      created: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      rootId: rid, currentNodeId: rid,
      nodes: { [rid]: { id: rid, parentId: null, depth: 0, label: "New chat", messages: [] } },
    };
    const next = { ...store, chats: { ...store.chats, [cid]: chat }, chatOrder: [cid, ...store.chatOrder] };
    persist(next);
    setActiveChatId(cid);
    setActiveNodeId(rid);
    setReflectMode(false);
  };

  const selectChat = (id) => {
    const c = store.chats[id];
    setActiveChatId(id);
    setActiveNodeId(c.currentNodeId || c.rootId);
    setReflectMode(false);
  };

  const selectNode = (cid, nid) => {
    setActiveChatId(cid);
    setActiveNodeId(nid);
    setReflectMode(false);
    // Update chat's currentNodeId
    const next = { ...store, chats: { ...store.chats, [cid]: { ...store.chats[cid], currentNodeId: nid } } };
    persist(next);
  };

  const navTree = (dir) => {
    if (!activeChat || !activeNode) return;
    if (dir === "up" && activeNode.parentId) {
      setActiveNodeId(activeNode.parentId);
    } else if (dir === "down") {
      const kids = childrenOf(activeChat, activeNodeId);
      if (kids.length) setActiveNodeId(kids[0].id);
    }
  };

  // ---- Branching from selection ----
  const doBranch = (text) => {
    if (!activeChat) return;
    const truncated = text.length > 80 ? text.slice(0, 80) + "…" : text;
    const label = text.length > 50 ? text.slice(0, 50) + "…" : text;
    const nid = newId("n");
    const newNode = {
      id: nid, parentId: activeNodeId,
      depth: activeNode.depth + 1,
      label,
      messages: [],
    };
    const next = {
      ...store,
      chats: {
        ...store.chats,
        [activeChatId]: {
          ...activeChat,
          nodes: { ...activeChat.nodes, [nid]: newNode },
          currentNodeId: prefs.branchMode === "follow" ? nid : activeNodeId,
        },
      },
    };
    persist(next);
    setDrafts(d => ({
      ...d,
      [`${activeChatId}:${nid}`]: {
        text: "",
        files: [],
        quote: truncated,
      },
    }));
    setSelectionState(null);
    window.getSelection?.()?.removeAllRanges?.();

    if (prefs.branchMode === "follow") {
      setActiveNodeId(nid);
      setToast({ message: "Branched. Editing new node." });
    } else {
      setToast({ message: "Branched. Open the new node →", actionLabel: "Open", action: () => setActiveNodeId(nid) });
    }
  };

  // ---- Send message ----
  const send = async () => {
    if (!draft.text.trim() && draft.files.length === 0) return;

    const userMsg = {
      role: "user",
      content: draft.text.trim(),
      quote: draft.quote || null,
      files: draft.files.length ? draft.files.map(f => ({ kind: f.kind, name: f.name })) : undefined,
    };
    const model = resolveModel(prefs.model);

    const newMessages = [...activeNode.messages, userMsg];
    const next1 = {
      ...store,
      chats: {
        ...store.chats,
        [activeChatId]: {
          ...activeChat,
          // If this is the first message in a new chat, use the prompt as the chat title
          title: activeChat.title === "New chat" && activeChat.rootId === activeNodeId && activeChat.nodes[activeNodeId].messages.length === 0
            ? userMsg.content.slice(0, 60)
            : activeChat.title,
          nodes: {
            ...activeChat.nodes,
            [activeNodeId]: {
              ...activeNode,
              label: activeNode.label === "New chat" || (activeNode.depth === 0 && activeChat.nodes[activeNodeId].messages.length === 0)
                ? userMsg.content.slice(0, 50)
                : activeNode.label,
              messages: newMessages,
            },
          },
        },
      },
    };
    persist(next1);
    setDrafts(d => ({ ...d, [draftKey]: { text: "", files: [], quote: null } }));
    setThinking(true);

    // Synthesize reply
    await new Promise(r => setTimeout(r, 700 + Math.random() * 800));
    const replyText = fakeReply(userMsg.content, model);

    // Compute exact credits + token breakdown for the post-send footer.
    const inputTokens =
      roughTokens(userMsg.content) +
      newMessages.reduce((s, m) => s + roughTokens(m.content || ""), 0) +
      // also count the rest of the path (everything above this node)
      pathToRoot(activeChat, activeNodeId)
        .slice(0, -1)
        .reduce((s, n) => s + n.messages.reduce((a, m) => a + roughTokens(m.content || ""), 0), 0);
    const outputTokens = roughTokens(replyText);
    const costUsd = calculateCostUsd(inputTokens, outputTokens, model);
    const pathDepth = pathToRoot(activeChat, activeNodeId).length;
    const replyMsg = {
      role: "assistant",
      model: prefs.model,
      costUsd,
      inputTokens,
      outputTokens,
      pathDepth,
      content: replyText,
    };

    setStore(prev => {
      const c = prev.chats[activeChatId];
      const n = c.nodes[activeNodeId];
      const updated = {
        ...prev,
        chats: {
          ...prev.chats,
          [activeChatId]: {
            ...c,
            nodes: {
              ...c.nodes,
              [activeNodeId]: { ...n, messages: [...n.messages, replyMsg] },
            },
          },
        },
      };
      saveStore(updated);
      return updated;
    });
    setThinking(false);
  };

  // ---- Composer helpers ----
  const setDraftText = (text) => setDrafts(d => ({ ...d, [draftKey]: { ...(d[draftKey] || { files: [] }), text, files: (d[draftKey]?.files) || [], quote: (d[draftKey]?.quote) || null } }));
  const clearQuote = () => setDrafts(d => ({ ...d, [draftKey]: { ...(d[draftKey] || {}), quote: null, text: d[draftKey]?.text || "", files: d[draftKey]?.files || [] } }));
  const addFile = (f) => setDrafts(d => ({ ...d, [draftKey]: { ...(d[draftKey] || { text: "", files: [] }), files: [...(d[draftKey]?.files || []), f], text: d[draftKey]?.text || "", quote: d[draftKey]?.quote || null } }));
  const removeFile = (id) => setDrafts(d => ({ ...d, [draftKey]: { ...(d[draftKey] || {}), files: (d[draftKey]?.files || []).filter(f => f.id !== id), text: d[draftKey]?.text || "", quote: d[draftKey]?.quote || null } }));
  const setModel = (id) => { const np = { ...prefs, model: id }; setPrefs(np); savePrefs(np); };

  // ---- Reflections actions ----
  const editMsg = (idx, newContent) => {
    setStore(prev => {
      const c = prev.chats[activeChatId];
      const n = c.nodes[activeNodeId];
      const msgs = n.messages.map((m, i) => i === idx ? { ...m, content: newContent } : m);
      const upd = { ...prev, chats: { ...prev.chats, [activeChatId]: { ...c, nodes: { ...c.nodes, [activeNodeId]: { ...n, messages: msgs } } } } };
      saveStore(upd);
      return upd;
    });
  };
  const deleteMsg = (idx) => {
    setStore(prev => {
      const c = prev.chats[activeChatId];
      const n = c.nodes[activeNodeId];
      const msgs = n.messages.filter((_, i) => i !== idx);
      const upd = { ...prev, chats: { ...prev.chats, [activeChatId]: { ...c, nodes: { ...c.nodes, [activeNodeId]: { ...n, messages: msgs } } } } };
      saveStore(upd);
      return upd;
    });
  };
  const mergeMsgNext = (idx) => {
    setStore(prev => {
      const c = prev.chats[activeChatId];
      const n = c.nodes[activeNodeId];
      if (idx >= n.messages.length - 1) return prev;
      const a = n.messages[idx], b = n.messages[idx + 1];
      const merged = { ...a, content: (a.content || "") + "\n\n" + (b.content || "") };
      const msgs = [...n.messages.slice(0, idx), merged, ...n.messages.slice(idx + 2)];
      const upd = { ...prev, chats: { ...prev.chats, [activeChatId]: { ...c, nodes: { ...c.nodes, [activeNodeId]: { ...n, messages: msgs } } } } };
      saveStore(upd);
      return upd;
    });
  };

  // ---- Top bar pieces ----
  const TopBar = () => (
    <div className="topbar">
      <div className="crumb">
        <span className="c-title">{activeChat?.title || "—"}</span>
        {path.length > 1 && <span className="c-sep">/</span>}
        {path.slice(1).map((n, i) => (
          <React.Fragment key={n.id}>
            <span className={`c-node d${Math.min(3, n.depth)}`}>
              <span className="c-dot"></span>
              {n.label.length > 22 ? n.label.slice(0, 22) + "…" : n.label}
            </span>
            {i < path.length - 2 && <span className="c-sep">›</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-actions">
        <button className="tb-btn" onClick={() => setShowTree(true)} title="Tree view">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="3" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="3" cy="13" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="13" cy="13" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M8 5 V8 M8 8 L3 11 M8 8 L13 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Tree
          <span className="tb-kbd">⌃T</span>
        </button>
        <button
          className={`tb-btn ${reflectMode ? "lilac" : ""}`}
          onClick={() => setReflectMode(v => !v)}
          title="Reflections mode"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8 a5 5 0 1 1 10 0 a5 5 0 1 1 -10 0 Z" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M5.5 7 Q8 4 10.5 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
          </svg>
          Reflect
          <span className="tb-kbd">⌃R</span>
        </button>
        <button className="tb-btn" onClick={() => setShowJump(true)} title="Quick jump">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10 L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Jump
          <span className="tb-kbd">⌃Q</span>
        </button>
      </div>
    </div>
  );

  // ---- Reflections banner ----
  const ReflectBanner = () => (
    <div className="reflect-banner">
      <svg className="rb-icon" viewBox="0 0 20 20" fill="none">
        <path d="M3 10 Q10 4 17 10 Q10 16 3 10 Z" stroke="currentColor" strokeWidth="1.6" fill="none"/>
        <circle cx="10" cy="10" r="2" fill="currentColor"/>
      </svg>
      <div>
        <div className="rb-title">Reflections mode — editing the golden path</div>
        <div className="rb-sub">Click to edit. Delete what's noise. Merge what belongs together.</div>
      </div>
      <div className="rb-actions">
        <button onClick={() => setToast({ message: "Reflection saved." })}>Save as note</button>
        <button className="exit" onClick={() => setReflectMode(false)}>Done</button>
      </div>
    </div>
  );

  return (
    <div className="shell">
      <Sidebar
        store={store}
        activeChatId={activeChatId}
        activeNodeId={activeNodeId}
        onNewChat={handleNewChat}
        onSelectChat={selectChat}
        onSelectNode={selectNode}
        onOpenSettings={() => { setSettingsFocusSection(null); setShowSettings(true); }}
        onNavigate={(target) => { if (target === "shortcuts") setShowShortcuts(true); }}
      />

      <div className="main">
        {activeChat ? (
          <>
            <TopBar/>
            {reflectMode && <ReflectBanner/>}

            <div className={`stream ${reflectMode ? "reflecting" : ""}`} ref={streamRef}>
              {activeNode.messages.length === 0 && !thinking ? (
                <EmptyChat onSuggest={(t) => setDraftText(t)}/>
              ) : (
                <div className="stream-inner">
                  {activeNode.messages.map((m, i) => (
                    <Message
                      key={i}
                      msg={m}
                      idx={i}
                      reflecting={reflectMode}
                      onEdit={editMsg}
                      onDelete={deleteMsg}
                      onMergeNext={mergeMsgNext}
                      isLast={i === activeNode.messages.length - 1}
                    />
                  ))}
                  {thinking && (
                    <div className="msg assistant">
                      <div className="m-head">
                        <span className="m-avatar" style={{ background: resolveModel(prefs.model).color }}>{resolveModel(prefs.model).initials}</span>
                        <span>{resolveModel(prefs.model).name}</span>
                      </div>
                      <div className="m-body">
                        <div className="thinking"><i></i><i></i><i></i></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {!reflectMode && (
              <div className="composer-wrap">
                <Composer
                  value={draft.text}
                  onChange={setDraftText}
                  onSend={send}
                  quote={draft.quote}
                  onClearQuote={clearQuote}
                  files={draft.files}
                  onAddFile={addFile}
                  onRemoveFile={removeFile}
                  modelId={prefs.model}
                  onChangeModel={setModel}
                  disabled={thinking}
                  pathMessages={path.flatMap(n => n.messages)}
                  onOpenSettings={() => { setSettingsFocusSection("models"); setShowSettings(true); }}
                />
              </div>
            )}
          </>
        ) : (
          <div className="empty">
            <div className="empty-inner">
              <h2>No chat open.</h2>
              <p>Pick one from the sidebar, or <a href="#" onClick={(e) => { e.preventDefault(); handleNewChat(); }} style={{ color: "var(--coral)", textDecoration: "underline" }}>start a new one</a>.</p>
            </div>
          </div>
        )}
      </div>

      {selectionState && !reflectMode && (
        <SelectionPopup
          selection={selectionState}
          onBranch={() => doBranch(selectionState.text)}
          onAsk={() => {
            setDrafts(d => ({ ...d, [draftKey]: { ...(d[draftKey] || { files: [] }), quote: selectionState.text.length > 80 ? selectionState.text.slice(0, 80) + "…" : selectionState.text, text: "", files: d[draftKey]?.files || [] } }));
            setSelectionState(null);
            window.getSelection?.()?.removeAllRanges?.();
          }}
          onClose={() => { setSelectionState(null); window.getSelection?.()?.removeAllRanges?.(); }}
        />
      )}

      {showJump && (
        <QuickJump
          store={store}
          activeChatId={activeChatId}
          onClose={() => setShowJump(false)}
          onJump={(cid, nid) => { selectNode(cid, nid); setShowJump(false); }}
        />
      )}

      {showTree && activeChat && (
        <TreeMap
          chat={activeChat}
          currentNodeId={activeNodeId}
          onClose={() => setShowTree(false)}
          onPick={(nid) => { setActiveNodeId(nid); setShowTree(false); }}
        />
      )}

      {showShortcuts && <ShortcutsPanel onClose={() => setShowShortcuts(false)}/>}

      {showSettings && (
        <SettingsModal
          focusSection={settingsFocusSection}
          onClose={() => setShowSettings(false)}
        />
      )}

      {toast && (
        <Toast onDone={() => setToast(null)}>
          {toast.message}
          {toast.actionLabel && (
            <button
              onClick={() => { toast.action?.(); setToast(null); }}
              style={{ marginLeft: 10, color: "var(--coral-soft)", textDecoration: "underline" }}
            >{toast.actionLabel}</button>
          )}
        </Toast>
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<ChatApp/>);
