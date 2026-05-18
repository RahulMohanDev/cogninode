// src/components/chat/Composer.tsx
// Textarea + model picker + cost pill + file attach. Persists draft per
// (chatId, nodeId) in localStorage. The streaming hook is owned by ChatApp;
// Composer just consumes send/cancel/state via props.

import { useEffect, useRef, useState } from "react";
import { useCostEstimate }      from "../../hooks/useCostEstimate";
import { useSettings }          from "../../hooks/useSettings";
import { getAllModels, formatEstimate, type ModelDef } from "../../lib/cost";
import { storeFile, type ProcessedFile }               from "../../lib/files";

export interface ComposerSendParams {
  modelId:      string;
  composerText: string;
  quote?:       string;
  fileIds?:     string[];
}

export interface ComposerProps {
  chatId:          string;
  currentNodeId:   string;
  streamState:     "idle" | "streaming" | "error";
  onSend:          (params: ComposerSendParams) => void | Promise<void>;
  onCancel:        () => void;
  quote?:          string;
  initialText?:    string;
  onClearQuote?:   () => void;
  onOpenSettings?: () => void;
}

const DRAFT_KEY = (chatId: string, nodeId: string) => `cogninode_draft_${chatId}:${nodeId}`;

function loadDraft(chatId: string, nodeId: string): string {
  try { return localStorage.getItem(DRAFT_KEY(chatId, nodeId)) ?? ""; }
  catch { return ""; }
}

function saveDraft(chatId: string, nodeId: string, value: string): void {
  try {
    if (value) localStorage.setItem(DRAFT_KEY(chatId, nodeId), value);
    else       localStorage.removeItem(DRAFT_KEY(chatId, nodeId));
  } catch { /* ignore */ }
}

export function Composer({
  chatId,
  currentNodeId,
  streamState,
  onSend,
  onCancel,
  quote,
  initialText,
  onClearQuote,
  onOpenSettings,
}: ComposerProps) {
  const { prefs }            = useSettings();
  const [text,   setText]    = useState(() => initialText ?? loadDraft(chatId, currentNodeId));
  const [files,  setFiles]   = useState<ProcessedFile[]>([]);
  const [modelId, setModelId] = useState<string>(prefs.defaultModelId);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const taRef    = useRef<HTMLTextAreaElement | null>(null);
  const fileRef  = useRef<HTMLInputElement | null>(null);

  // Reset state when the active node changes (load that node's draft).
  useEffect(() => {
    setText(initialText ?? loadDraft(chatId, currentNodeId));
    setFiles([]);
  }, [chatId, currentNodeId, initialText]);

  // Persist draft on change.
  useEffect(() => {
    saveDraft(chatId, currentNodeId, text);
  }, [chatId, currentNodeId, text]);

  // Autosize textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(200, ta.scrollHeight) + "px";
  }, [text]);

  // Resolve model object.
  const allModels = getAllModels(prefs.customModels);
  const model: ModelDef = allModels.find(m => m.id === modelId) ?? allModels[0]!;
  const initials = model.name.split(" ").slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase().slice(0, 2);

  // Cost pill — colour band per spec section 8.
  const estCost = useCostEstimate(text, currentNodeId, chatId, model.id);
  const pillClass =
    estCost === 0    ? "cp-free" :
    estCost < 0.005  ? "cp-low"  :
    estCost <= 0.02  ? "cp-mid"  : "cp-high";

  const handleFiles = async (list: FileList | null): Promise<void> => {
    if (!list || list.length === 0) return;
    for (const file of Array.from(list)) {
      if (file.type.startsWith("image/") && file.size > 2_000_000) {
        const ok = window.confirm(`"${file.name}" is ${(file.size / 1_000_000).toFixed(1)} MB. Attach anyway?`);
        if (!ok) continue;
      }
      const stored = await storeFile(file);
      setFiles(prev => [...prev, stored]);
      if (stored.textToAppend) {
        setText(prev => prev + stored.textToAppend);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeFile = (fileId: string): void => {
    setFiles(prev => prev.filter(f => f.fileId !== fileId));
  };

  const handleSend = (): void => {
    const composerText = text.trim();
    if (!composerText && files.length === 0) return;
    if (streamState === "streaming") return;
    const fileIds = files.map(f => f.fileId);
    // Clear local state before firing — the assistant tail handles itself.
    setText("");
    setFiles([]);
    saveDraft(chatId, currentNodeId, "");
    onClearQuote?.();
    void onSend({
      modelId: model.id,
      composerText,
      ...(quote !== undefined ? { quote } : {}),
      ...(fileIds.length ? { fileIds } : {}),
    });
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="composer">
      {quote && (
        <span className="quote-chip">
          <span className="qc-from">branched</span>
          <span className="qc-text">"{quote}"</span>
          {onClearQuote && (
            <button className="qc-x" onClick={onClearQuote} title="Clear quote">
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </span>
      )}

      {files.length > 0 && (
        <div className="files-row">
          {files.map(f => (
            <span key={f.fileId} className="file-chip">
              <span className={`fc-icon ${f.kind === "code" ? "code" : f.kind === "pdf" ? "pdf" : "img"}`}>
                {f.kind === "pdf" ? "PDF" : f.kind === "code" ? "<>" : f.kind === "image" ? "IMG" : "FILE"}
              </span>
              {f.name}
              <button className="fc-x" onClick={() => removeFile(f.fileId)}>
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        placeholder={quote ? "Ask about this passage…" : "Ask anything. Select any reply to branch."}
        rows={1}
        disabled={streamState === "streaming"}
      />

      <div className="composer-bottom">
        <div className="left">
          <button
            className="tool"
            onClick={() => fileRef.current?.click()}
            title="Attach file"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M11 4 L5 10 a2 2 0 1 0 3 3 L13 7 a3 3 0 1 0 -4 -4 L4 8"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => void handleFiles(e.target.files)}
          />

          <button
            className="model-pick"
            type="button"
            onClick={() => setModelPickerOpen(v => !v)}
          >
            <span className="m-dot" style={{ background: "var(--ink-2)" }}>{initials}</span>
            <span>{model.name.split(" ").slice(0, 2).join(" ")}</span>
            <svg className="caret" viewBox="0 0 10 10">
              <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.4" fill="none"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {modelPickerOpen && (
              <>
                <div
                  style={{ position: "fixed", inset: 0, zIndex: 29 }}
                  onClick={(e) => { e.stopPropagation(); setModelPickerOpen(false); }}
                />
                <div className="model-pop" onClick={(e) => e.stopPropagation()}>
                  {allModels.map(m => {
                    const mInitials = m.name.split(" ").slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase().slice(0, 2);
                    const isFree = m.inputPricePerM === 0 && m.outputPricePerM === 0;
                    return (
                      <div
                        key={m.id}
                        className={`mp-row ${m.id === model.id ? "active" : ""}`}
                        onClick={() => { setModelId(m.id); setModelPickerOpen(false); }}
                      >
                        <span className="m-dot" style={{ background: "var(--ink-2)" }}>{mInitials}</span>
                        <div className="mp-meta">
                          <span className="mp-name">{m.name}</span>
                          <span className="mp-tag">{m.vendor.toLowerCase()} · {m.tag}</span>
                        </div>
                        <span className={`mp-cred ${isFree ? "is-free" : ""}`}>
                          {isFree ? "free" : `$${m.inputPricePerM.toFixed(2)}/M`}
                        </span>
                      </div>
                    );
                  })}
                  {onOpenSettings && (
                    <>
                      <div className="mp-sep" />
                      <div
                        className="mp-row mp-add"
                        onClick={() => { setModelPickerOpen(false); onOpenSettings(); }}
                      >
                        <span className="m-dot mp-add-icon">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <path d="M8 3 V13 M3 8 H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </span>
                        <div className="mp-meta">
                          <span className="mp-name">Add custom model</span>
                          <span className="mp-tag">any openrouter model string</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </button>

          <span className={`cost-pill ${pillClass}`} title={`Estimated cost on ${model.name}`}>
            {formatEstimate(estCost)}
          </span>
        </div>

        {streamState === "streaming" ? (
          <button
            className="send"
            onClick={onCancel}
            title="Cancel"
            type="button"
            style={{ background: "var(--ink-3)" }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            className="send"
            disabled={!text.trim() && files.length === 0}
            onClick={handleSend}
            title="Send (Cmd/Ctrl+Enter)"
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8 H13 M9 4 L13 8 L9 12"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export default Composer;
