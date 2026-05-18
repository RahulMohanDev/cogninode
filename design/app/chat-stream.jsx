// chat-stream.jsx — Stream, Message, Composer, SelectionPopup, UploadMenu

const { renderBody, getModel, ModelDot, MODELS, fmt, calculateCredits, estimateCredits } = window;

// ------------------------------------------------------------------
// Credit pill — colour-coded estimate shown in the composer footer
// ------------------------------------------------------------------
const CreditPill = ({ credits, model }) => {
  const cls =
    credits === 0 ? "cr-free" :
    credits <= 5  ? "cr-low"  :
    credits <= 15 ? "cr-mid"  : "cr-high";
  const label = credits === 0 ? "free" : `~${credits} cr`;
  return (
    <span className={`credit-pill ${cls}`} title={`Estimated cost on ${model?.name || "this model"}`}>
      {label}
    </span>
  );
};

// ------------------------------------------------------------------
// Selection popup — appears when user selects text in an assistant message
// ------------------------------------------------------------------
const SelectionPopup = ({ selection, onBranch, onAsk, onReflect, onClose }) => {
  if (!selection) return null;
  // Pin above the selection
  const top = Math.max(70, selection.rect.top - 50);
  const left = Math.max(10, selection.rect.left + selection.rect.width / 2 - 130);
  return (
    <div className="sel-pop" style={{ top, left }}>
      <button className="primary" onClick={onBranch}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="3" r="1.6" fill="currentColor"/>
          <circle cx="12" cy="3" r="1.6" fill="currentColor"/>
          <circle cx="8" cy="13" r="1.6" fill="currentColor"/>
          <path d="M4 4.5 V8 H12 V4.5 M8 8 V11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        Branch from here
        <span className="kbd">⌃B</span>
      </button>
      <span className="sep"></span>
      <button onClick={onAsk}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M2 7 a6 6 0 1 1 6 6 H2 V11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Ask about this
      </button>
      <button onClick={onClose}>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
};

// ------------------------------------------------------------------
// Single message
// ------------------------------------------------------------------
const Message = ({ msg, idx, reflecting, onEdit, onDelete, isLast, onMergeNext }) => {
  const model = msg.model ? getModel(msg.model) : null;
  const isAssistant = msg.role === "assistant";
  const bodyRef = React.useRef(null);

  return (
    <div className={`msg ${msg.role} ${reflecting ? "reflecting" : ""}`}>
      {reflecting && (
        <div className="reflect-handles">
          <button title="Delete this" className="delete" onClick={() => onDelete?.(idx)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 5 H13 M6 5 V3 H10 V5 M5 5 V13 H11 V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}

      <div className="m-head">
        {isAssistant && model && (
          <>
            <span className="m-avatar" style={{ background: model.color }}>{model.initials}</span>
            <span>{model.name}</span>
          </>
        )}
        {!isAssistant && (
          <span>You</span>
        )}
      </div>

      <div
        ref={bodyRef}
        className="m-body"
        contentEditable={reflecting}
        suppressContentEditableWarning
        onBlur={reflecting ? (e) => onEdit?.(idx, e.currentTarget.innerText) : undefined}
        data-msg-idx={idx}
      >
        {msg.quote && !reflecting && (
          <div className="quote-block">
            <span className="quote-from">↳ branched from</span>
            <span className="quote-text">"{msg.quote}"</span>
          </div>
        )}
        {reflecting ? msg.content : renderBody(msg.content)}
      </div>

      {!reflecting && isAssistant && model && (
        <div className="m-foot">
          <span className="credits">
            <span className="cd"></span>
            {msg.credits} {msg.credits === 1 ? "credit" : "credits"}
            {typeof msg.inputTokens === "number" && typeof msg.outputTokens === "number" && (
              <span className="cr-detail">
                &nbsp;·&nbsp;{msg.inputTokens.toLocaleString()} in + {msg.outputTokens.toLocaleString()} out
                {typeof msg.pathDepth === "number" && <>&nbsp;·&nbsp;{msg.pathDepth}-node path</>}
              </span>
            )}
          </span>
          <div className="m-actions">
            <button title="Copy">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M3 11 V3 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
            <button title="Regenerate">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M13 8 a5 5 0 1 1 -1.5 -3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M13 2 V5 H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {reflecting && !isLast && (
        <div className="merge-handle">
          <button onClick={() => onMergeNext?.(idx)}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path d="M2 5 L8 11 L14 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Merge with next
          </button>
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------------
// Upload menu
// ------------------------------------------------------------------
const UploadMenu = ({ onPick, onClose }) => (
  <>
    <div style={{ position: "fixed", inset: 0, zIndex: 29 }} onClick={onClose}></div>
    <div className="upload-pop">
      <button onClick={() => onPick("pdf")}>
        <span className="up-icon pdf">PDF</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500 }}>PDF or doc</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>up to 32 MB</div>
        </div>
      </button>
      <button onClick={() => onPick("code")}>
        <span className="up-icon code">{"</>"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500 }}>Code file</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>.py, .ts, .js, .go…</div>
        </div>
      </button>
      <button onClick={() => onPick("img")}>
        <span className="up-icon img">IMG</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500 }}>Image</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>png, jpg, webp</div>
        </div>
      </button>
    </div>
  </>
);

// ------------------------------------------------------------------
// Model picker dropdown
// ------------------------------------------------------------------
const ModelPicker = ({ currentId, onPick, onClose }) => (
  <>
    <div style={{ position: "fixed", inset: 0, zIndex: 29 }} onClick={onClose}></div>
    <div className="model-pop">
      {MODELS.map(m => (
        <div
          key={m.id}
          className={`mp-row ${currentId === m.id ? "active" : ""}`}
          onClick={() => { onPick(m.id); onClose(); }}
        >
          <span className="m-dot" style={{ background: m.color }}>{m.initials}</span>
          <div className="mp-meta">
            <span className="mp-name">{m.name}</span>
            <span className="mp-tag">{m.vendor.toLowerCase()} · {m.tag}</span>
          </div>
          <span className="mp-cred">{calculateCredits(1200, 600, m)} cr</span>
        </div>
      ))}
    </div>
  </>
);

// ------------------------------------------------------------------
// Composer
// ------------------------------------------------------------------
const Composer = ({ value, onChange, onSend, quote, onClearQuote, files, onAddFile, onRemoveFile, modelId, onChangeModel, disabled, pathMessages }) => {
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [estCredits, setEstCredits] = React.useState(0);
  const taRef = React.useRef(null);

  // Recalculate credit estimate on text / model / path change. Debounced 150ms
  // so the pill doesn't repaint on every single keystroke for long messages.
  React.useEffect(() => {
    const model = getModel(modelId);
    const t = setTimeout(() => {
      setEstCredits(estimateCredits(value, pathMessages || [], model));
    }, 150);
    return () => clearTimeout(t);
  }, [value, modelId, pathMessages]);

  // Auto-grow textarea
  React.useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = "auto";
    taRef.current.style.height = Math.min(200, taRef.current.scrollHeight) + "px";
  }, [value]);

  const handlePickFile = (kind) => {
    setUploadOpen(false);
    // Fake an upload — synthesize a file chip
    const fakeNames = {
      pdf: ["Q3-report.pdf", "research-paper.pdf", "tickets.pdf"],
      code: ["server.ts", "api.py", "auth.go"],
      img: ["screenshot.png", "diagram.png", "photo.jpg"],
    };
    const name = fakeNames[kind][Math.floor(Math.random() * 3)];
    onAddFile({ id: Math.random().toString(36).slice(2), kind, name });
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && (value.trim() || files.length)) onSend();
    }
  };

  const model = getModel(modelId);

  return (
    <div className="composer">
      {quote && (
        <span className="quote-chip">
          <span className="qc-from">branched</span>
          <span className="qc-text">"{quote}"</span>
          <button className="qc-x" onClick={onClearQuote} title="Clear quote">
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </span>
      )}

      {files.length > 0 && (
        <div className="files-row">
          {files.map(f => (
            <span key={f.id} className="file-chip">
              <span className={`fc-icon ${f.kind}`}>{f.kind === "pdf" ? "PDF" : f.kind === "code" ? "<>" : "IMG"}</span>
              {f.name}
              <button className="fc-x" onClick={() => onRemoveFile(f.id)}>
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        placeholder={quote ? "Ask about this passage…" : "Ask anything. Select any reply to branch."}
        rows={1}
      />

      {estCredits > 15 && (
        <div className="branch-hint">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 3 V13 M3 8 H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          Branch to reset path — save ~{Math.round(estCredits * 0.55)} credits
        </div>
      )}

      <div className="composer-bottom">
        <div className="left">
          <button
            className={`tool ${uploadOpen ? "active" : ""}`}
            onClick={() => setUploadOpen(v => !v)}
            title="Attach"
            style={{ position: "relative" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M11 4 L5 10 a2 2 0 1 0 3 3 L13 7 a3 3 0 1 0 -4 -4 L4 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {uploadOpen && <UploadMenu onPick={handlePickFile} onClose={() => setUploadOpen(false)}/>}
          </button>

          <button className="model-pick" onClick={() => setModelOpen(v => !v)}>
            <span className="m-dot" style={{ background: model.color }}>{model.initials}</span>
            <span>{model.name.split(" ").slice(0, 2).join(" ")}</span>
            <svg className="caret" viewBox="0 0 10 10">
              <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {modelOpen && <ModelPicker currentId={modelId} onPick={onChangeModel} onClose={() => setModelOpen(false)}/>}
          </button>

          <CreditPill credits={estCredits} model={model} />
        </div>

        <button
          className="send"
          disabled={disabled || (!value.trim() && !files.length)}
          onClick={onSend}
          title="Send (Enter)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8 H13 M9 4 L13 8 L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

Object.assign(window, { SelectionPopup, Message, UploadMenu, ModelPicker, Composer, CreditPill });
