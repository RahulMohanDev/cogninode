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
  webSearch?:   boolean;
}

export interface ComposerProps {
  chatId:                string;
  currentNodeId:         string;
  streamState:           "idle" | "streaming" | "error";
  onSend:                (params: ComposerSendParams) => void | Promise<void>;
  onCancel:              () => void;
  quote?:                string;
  initialText?:          string;
  onClearQuote?:         () => void;
  onOpenSettings?:       () => void;
  /** Creates an empty branch from the current node — no quote, no message. */
  onCreateBlankBranch?:  () => void;
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

// Web-search toggle is sticky across messages — persisted globally, not
// per (chatId, nodeId), so the user's choice survives navigation and sends.
const WEB_SEARCH_KEY = "cogninode_web_search";

function loadWebSearch(): boolean {
  try { return localStorage.getItem(WEB_SEARCH_KEY) === "1"; }
  catch { return false; }
}

function saveWebSearch(on: boolean): void {
  try { localStorage.setItem(WEB_SEARCH_KEY, on ? "1" : "0"); }
  catch { /* ignore */ }
}


// Cost-pill tone by estimate bucket (cp-* keys come from the estimator).
const PILL: Record<string, string> = {
  "cp-free": "tw:bg-teal-tint tw:text-teal",
  "cp-low":  "tw:bg-teal-tint tw:text-teal",
  "cp-mid":  "tw:bg-butter-tint tw:text-[#8a5a0a] tw:dark:text-butter",
  "cp-high": "tw:bg-coral-tint tw:text-coral",
};

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
  onCreateBlankBranch,
}: ComposerProps) {
  const { prefs }            = useSettings();
  const [text,   setText]    = useState(() => initialText ?? loadDraft(chatId, currentNodeId));
  const [files,  setFiles]   = useState<ProcessedFile[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const [modelId, setModelId] = useState<string>(prefs.defaultModelId);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [webSearch, setWebSearch] = useState<boolean>(loadWebSearch);
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
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        if (file.type.startsWith("image/") && file.size > 2_000_000) {
          const ok = window.confirm(`"${file.name}" is ${(file.size / 1_000_000).toFixed(1)} MB. Attach anyway?`);
          if (!ok) continue;
        }
        try {
          const stored = await storeFile(file);
          setFiles(prev => [...prev, stored]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setUploadError(`Couldn't attach "${file.name}": ${msg}`);
          console.error(`storeFile failed for ${file.name}:`, err);
        }
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeFile = (fileId: string): void => {
    setFiles(prev => prev.filter(f => f.fileId !== fileId));
  };

  const toggleWebSearch = (): void => {
    setWebSearch(prev => {
      const next = !prev;
      saveWebSearch(next);
      return next;
    });
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
      ...(webSearch ? { webSearch: true } : {}),
    });
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="tw:max-w-[780px] tw:mx-auto tw:bg-bg-3 tw:border tw:border-line tw:rounded-[16px] tw:shadow-2 tw:p-2 tw:pointer-events-auto tw:transition-[border-color] tw:duration-[120ms] tw:ease-[ease] tw:focus-within:border-ink-3 tw:dark:shadow-[0_14px_30px_-18px_rgba(0,0,0,0.6)]">
      {quote && (
        <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1 tw:px-2.5 tw:rounded-[999px] tw:bg-coral-tint tw:border tw:border-coral tw:text-[12px] tw:text-ink tw:max-w-full tw:mt-1 tw:mx-1 tw:mb-1.5">
          <span className="tw:font-mono tw:text-[9px] tw:tracking-[0.12em] tw:uppercase tw:text-coral tw:flex-none">branched</span>
          <span className="tw:font-serif tw:italic tw:truncate tw:max-w-[320px]">"{quote}"</span>
          {onClearQuote && (
            <button className="tw:w-4 tw:h-4 tw:rounded-[999px] tw:text-coral tw:grid tw:place-items-center tw:flex-none tw:hover:bg-coral tw:hover:text-white" onClick={onClearQuote} title="Clear quote">
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </span>
      )}

      {(files.length > 0 || uploading || uploadError) && (
        <div className="tw:flex tw:flex-wrap tw:gap-1.5 tw:pt-1 tw:px-1 tw:pb-1.5">
          {files.map(f => (
            <span key={f.fileId} className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1 tw:pr-2.5 tw:pl-1.5 tw:bg-bg-2 tw:border tw:border-line tw:rounded-[999px] tw:text-[12px] tw:text-ink">
              <span className={`tw:w-[22px] tw:h-[22px] tw:rounded-[5px] tw:grid tw:place-items-center tw:font-mono tw:text-[9px] tw:font-bold tw:text-white tw:tracking-[-0.02em] ${f.kind === "code" ? "tw:bg-[#2c2c2c] tw:dark:bg-[#4a4135]" : f.kind === "pdf" ? "tw:bg-[#e35d4d]" : "tw:bg-teal"}`}>
                {f.kind === "pdf" ? "PDF" : f.kind === "code" ? "<>" : f.kind === "image" ? "IMG" : "FILE"}
              </span>
              {f.name}
              <button className="tw:w-4 tw:h-4 tw:grid tw:place-items-center tw:rounded-[50%] tw:text-ink-3 tw:hover:bg-ink tw:hover:text-white" onClick={() => removeFile(f.fileId)}>
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
          {uploading && (
            <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1 tw:pr-2.5 tw:pl-1.5 tw:bg-bg-2 tw:border tw:border-line tw:rounded-[999px] tw:text-[12px] tw:text-ink tw:opacity-70">
              <span className="tw:w-[22px] tw:h-[22px] tw:rounded-[5px] tw:grid tw:place-items-center tw:font-mono tw:text-[9px] tw:font-bold tw:text-white tw:tracking-[-0.02em] tw:bg-teal">…</span>
              uploading…
            </span>
          )}
          {uploadError && (
            <span
              className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-1 tw:pr-2.5 tw:pl-1.5 tw:bg-bg-2 tw:border tw:border-line tw:rounded-[999px] tw:text-[12px] tw:text-ink tw:bg-[color-mix(in_oklab,var(--coral)_14%,var(--bg-3))] tw:border-[color-mix(in_oklab,var(--coral)_40%,var(--line))] tw:text-coral"
              title={uploadError}
            >
              <span className="tw:w-[22px] tw:h-[22px] tw:rounded-[5px] tw:grid tw:place-items-center tw:font-mono tw:text-[9px] tw:font-bold tw:text-white tw:tracking-[-0.02em] tw:bg-coral">!</span>
              {uploadError}
              <button className="tw:w-4 tw:h-4 tw:grid tw:place-items-center tw:rounded-[50%] tw:text-ink-3 tw:hover:bg-ink tw:hover:text-white" onClick={() => setUploadError(null)} title="Dismiss">
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          )}
        </div>
      )}

      <textarea
        className="tw:w-full tw:border-none tw:bg-transparent tw:outline-none tw:resize-none tw:text-[14.5px] tw:py-2 tw:px-2.5 tw:min-h-11 tw:max-h-[200px] tw:leading-[1.5] tw:text-ink tw:placeholder:text-ink-3"
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        placeholder={quote ? "Ask about this passage…" : "Ask anything. Select any reply to branch."}
        rows={1}
        disabled={streamState === "streaming"}
      />

      <div className="tw:flex tw:items-center tw:gap-1.5 tw:pt-1 tw:px-1 tw:pb-0.5">
        <div className="tw:flex tw:items-center tw:gap-1.5 tw:flex-1">
          <button
            className="tw:w-8 tw:h-8 tw:grid tw:place-items-center tw:rounded-[8px] tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:relative tw:text-ink-2 tw:hover:bg-bg-2 tw:hover:text-ink"
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
            className="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-[5px] tw:pr-[9px] tw:pl-1.5 tw:rounded-[8px] tw:border tw:border-line tw:bg-bg-3 tw:text-[12px] tw:text-ink tw:relative tw:hover:border-ink-3"
            type="button"
            onClick={() => setModelPickerOpen(v => !v)}
          >
            <span className="tw:w-4 tw:h-4 tw:rounded-[50%] tw:grid tw:place-items-center tw:text-white tw:text-[8px] tw:font-bold tw:tracking-[-0.04em]" style={{ background: "var(--ink-2)" }}>{initials}</span>
            <span>{model.name.split(" ").slice(0, 2).join(" ")}</span>
            <svg className="tw:w-2 tw:h-2 tw:opacity-50" viewBox="0 0 10 10">
              <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.4" fill="none"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {modelPickerOpen && (
              <>
                <div
                  style={{ position: "fixed", inset: 0, zIndex: 29 }}
                  onClick={(e) => { e.stopPropagation(); setModelPickerOpen(false); }}
                />
                <div className="tw:absolute tw:bottom-[calc(100%+6px)] tw:left-0 tw:bg-bg-3 tw:border tw:border-line tw:rounded-[12px] tw:p-1.5 tw:min-w-[270px] tw:shadow-3 tw:z-30 tw:animate-[popUp_0.15s_cubic-bezier(0.34,1.56,0.64,1)]" onClick={(e) => e.stopPropagation()}>
                  {allModels.map(m => {
                    const mInitials = m.name.split(" ").slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase().slice(0, 2);
                    const isFree = m.inputPricePerM === 0 && m.outputPricePerM === 0;
                    return (
                      <div
                        key={m.id}
                        className={`tw:flex tw:items-center tw:gap-2.5 tw:py-2 tw:px-2.5 tw:rounded-[8px] tw:text-[13px] tw:text-ink tw:cursor-pointer ${m.id === model.id ? "tw:bg-butter-tint" : "tw:hover:bg-bg-2"}`}
                        onClick={() => { setModelId(m.id); setModelPickerOpen(false); }}
                      >
                        <span className="tw:w-[22px] tw:h-[22px] tw:rounded-[50%] tw:grid tw:place-items-center tw:text-white tw:text-[10px] tw:font-bold tw:tracking-[-0.04em] tw:flex-none" style={{ background: "var(--ink-2)" }}>{mInitials}</span>
                        <div className="tw:flex-1 tw:flex tw:flex-col tw:gap-px">
                          <span className="tw:font-medium">{m.name}</span>
                          <span className="tw:font-mono tw:text-[10px] tw:text-ink-3">{m.vendor.toLowerCase()} · {m.tag}</span>
                        </div>
                        <span className={`tw:font-mono tw:text-[11px] tw:py-0.5 tw:px-[7px] tw:rounded-[999px] ${m.id === model.id ? "tw:bg-butter" : "tw:bg-bg-2"} ${isFree ? "tw:text-teal" : m.id === model.id ? "tw:text-ink" : "tw:text-ink-2"}`}>
                          {isFree ? "free" : `$${m.inputPricePerM.toFixed(2)}/M`}
                        </span>
                      </div>
                    );
                  })}
                  {onOpenSettings && (
                    <>
                      <div className="tw:h-px tw:bg-line tw:my-1.5 tw:mx-1" />
                      <div
                        className="tw:group/addrow tw:flex tw:items-center tw:gap-2.5 tw:py-2 tw:px-2.5 tw:rounded-[8px] tw:text-[13px] tw:text-ink tw:cursor-pointer tw:text-ink-3 tw:hover:text-ink tw:hover:bg-bg-2"
                        onClick={() => { setModelPickerOpen(false); onOpenSettings(); }}
                      >
                        <span className="tw:w-[22px] tw:h-[22px] tw:rounded-[50%] tw:grid tw:place-items-center tw:flex-none tw:text-[10px] tw:font-bold tw:tracking-[-0.04em] tw:bg-bg-2 tw:border tw:border-dashed tw:border-line tw:text-ink-3 tw:group-hover/addrow:border-coral tw:group-hover/addrow:text-coral">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <path d="M8 3 V13 M3 8 H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </span>
                        <div className="tw:flex-1 tw:flex tw:flex-col tw:gap-px">
                          <span className="tw:font-medium">Add custom model</span>
                          <span className="tw:font-mono tw:text-[10px] tw:text-ink-3">any openrouter model string</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </button>

          <span className={`tw:font-mono tw:text-[11px] tw:font-medium tw:tracking-[0.04em] tw:py-[3px] tw:px-[9px] tw:rounded-[999px] tw:transition-[background-color,color] tw:duration-200 tw:ease-[ease] ${PILL[pillClass]}`} title={`Estimated cost on ${model.name}`}>
            {formatEstimate(estCost)}
          </span>

          {onCreateBlankBranch && (
            <button
              className="tw:inline-flex tw:items-center tw:gap-[5px] tw:h-[26px] tw:py-0 tw:px-2.5 tw:rounded-[999px] tw:border tw:border-line tw:bg-transparent tw:text-ink-3 tw:text-[12px] tw:cursor-pointer tw:transition-[border-color,color,background-color] tw:duration-[120ms] tw:ease-[ease] tw:hover:border-ink-3 tw:hover:text-ink tw:hover:bg-bg-2 tw:[&_svg]:flex-none"
              type="button"
              onClick={() => onCreateBlankBranch()}
              title="Start an empty branch from this node"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="3"  r="1.6" stroke="currentColor" strokeWidth="1.4"/>
                <circle cx="3" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.4"/>
                <circle cx="13" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M8 4.6 V8 M8 8 L3 11.4 M8 8 L13 11.4"
                      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <span>+ new branch</span>
            </button>
          )}
        </div>

        <button
          className={`tw:w-8 tw:h-8 tw:grid tw:place-items-center tw:rounded-[8px] tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:relative ${webSearch ? "tw:bg-coral tw:text-white tw:hover:bg-[#ff4520]" : "tw:text-ink-2 tw:hover:bg-bg-2 tw:hover:text-ink"}`}
          type="button"
          onClick={toggleWebSearch}
          title="Web search — runs a paid OpenRouter web search for this message"
          aria-pressed={webSearch}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
            <path d="M2 8 H14 M8 2 C5 4.5 5 11.5 8 14 M8 2 C11 4.5 11 11.5 8 14"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </svg>
        </button>

        {streamState === "streaming" ? (
          <button
            className="tw:w-9 tw:h-9 tw:grid tw:place-items-center tw:bg-coral tw:text-white tw:rounded-[9px] tw:transition-[background-color,transform] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-[#ff4520] tw:hover:[transform:translateY(-1px)] tw:disabled:bg-ink-4 tw:disabled:cursor-not-allowed tw:disabled:[transform:none]"
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
            className="tw:w-9 tw:h-9 tw:grid tw:place-items-center tw:bg-coral tw:text-white tw:rounded-[9px] tw:transition-[background-color,transform] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-[#ff4520] tw:hover:[transform:translateY(-1px)] tw:disabled:bg-ink-4 tw:disabled:cursor-not-allowed tw:disabled:[transform:none]"
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
