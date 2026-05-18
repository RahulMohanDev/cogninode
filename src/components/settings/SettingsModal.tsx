// src/components/settings/SettingsModal.tsx
// Settings modal: API key, default model, branch mode, custom models CRUD,
// data export/import/clear, and about. Returns null when closed.

import { useEffect, useRef, useState } from "react";

import { db } from "../../lib/db";
import {
  BUILTIN_MODELS,
  getAllModels,
  formatCost,
  calculateCostUsd,
  type CustomModel,
} from "../../lib/cost";
import { exportAllChats, importFromJson } from "../../lib/export";
import { useSettings } from "../../hooks/useSettings";

export interface SettingsModalProps {
  open:    boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  // Esc to close — only when open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const { apiKey, clearApiKey, prefs, setPref } = useSettings();

  if (!open) return null;

  return (
    <div className="qj-overlay sm-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="sm-head">
          <span className="sm-head-icon">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M8 1 V3 M8 13 V15 M1 8 H3 M13 8 H15 M3 3 L4.5 4.5 M11.5 11.5 L13 13 M3 13 L4.5 11.5 M11.5 4.5 L13 3"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
              />
            </svg>
          </span>
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="sm-body">
          <ApiKeySection
            apiKey={apiKey}
            onRemoveKey={() => { clearApiKey(); onClose(); }}
          />

          <ModelSection
            customModels={prefs.customModels}
            defaultModelId={prefs.defaultModelId}
            onSelectDefault={id => setPref("defaultModelId", id)}
          />

          <BranchModeSection
            value={prefs.branchMode}
            onChange={v => setPref("branchMode", v)}
          />

          <CustomModelsSection
            customModels={prefs.customModels}
            onChange={list => setPref("customModels", list)}
          />

          <DataSection
            onClearAll={() => { clearApiKey(); onClose(); }}
          />

          <AboutSection />
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;

// ── Section 1: API key ───────────────────────────────────────────────────────

function ApiKeySection({
  apiKey,
  onRemoveKey,
}: {
  apiKey:      string;
  onRemoveKey: () => void;
}) {
  const [reveal, setReveal] = useState(false);

  const masked = apiKey
    ? apiKey.slice(0, 10) + "•".repeat(20)
    : "";

  return (
    <div className="sm-section">
      <div className="sm-section-h">
        <h3>OpenRouter API key</h3>
        <p>Stored in localStorage on this device only.</p>
      </div>

      <div className="card-row sm-card-row">
        <div className="sm-key-current">
          <div className="cr-title">Current key</div>
          <div className="api-key-masked">
            {apiKey
              ? (reveal ? apiKey : masked)
              : <span className="api-key-empty">No key set</span>}
          </div>
        </div>
        <div className="sm-key-actions">
          <button
            className="icon-btn"
            disabled={!apiKey}
            onClick={() => setReveal(v => !v)}
            title={reveal ? "Hide key" : "Reveal key"}
          >
            {reveal ? "Hide" : "Reveal"}
          </button>
          <button
            className="icon-btn danger"
            disabled={!apiKey}
            onClick={onRemoveKey}
            title="Remove key"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section 2: Default model ─────────────────────────────────────────────────

function ModelSection({
  customModels,
  defaultModelId,
  onSelectDefault,
}: {
  customModels:    CustomModel[];
  defaultModelId:  string;
  onSelectDefault: (id: string) => void;
}) {
  const all = getAllModels(customModels);

  return (
    <div className="sm-section">
      <div className="sm-section-h">
        <h3>Default model</h3>
        <p>Used for new messages. "Std msg" ≈ 1,200 in + 600 out tokens.</p>
      </div>
      {all.map(m => {
        const stdCost = calculateCostUsd(1200, 600, m);
        const isCustom = !BUILTIN_MODELS.some(b => b.id === m.id);
        return (
          <div key={m.id} className="card-row sm-card-row">
            <div>
              <div className="cr-title">
                {m.name}
                {isCustom && <span className="sm-custom-tag"> · custom</span>}
              </div>
              <div className="cr-sub">{m.vendor || "—"} · {m.tag}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="sm-cost-badge">
                {stdCost === 0 ? "free" : `${formatCost(stdCost)} / std msg`}
              </span>
              <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="defaultModel"
                  checked={defaultModelId === m.id}
                  onChange={() => onSelectDefault(m.id)}
                  style={{ accentColor: "var(--coral)" }}
                />
                <span style={{
                  fontSize: 11, color: "var(--ink-3)",
                  fontFamily: "var(--mono)", letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}>
                  Default
                </span>
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Section 3: Branch mode ───────────────────────────────────────────────────

function BranchModeSection({
  value,
  onChange,
}: {
  value:    "follow" | "stay";
  onChange: (v: "follow" | "stay") => void;
}) {
  return (
    <div className="sm-section">
      <div className="sm-section-h">
        <h3>Branch behaviour</h3>
        <p>What happens after you branch from a selection.</p>
      </div>

      <div className="card-row sm-card-row">
        <div>
          <div className="cr-title">Follow new branch</div>
          <div className="cr-sub">Jump to the freshly created branch automatically.</div>
        </div>
        <input
          type="radio"
          name="branchMode"
          checked={value === "follow"}
          onChange={() => onChange("follow")}
          style={{ accentColor: "var(--coral)" }}
        />
      </div>

      <div className="card-row sm-card-row">
        <div>
          <div className="cr-title">Stay on current node</div>
          <div className="cr-sub">Keep your place; branch is created in the background.</div>
        </div>
        <input
          type="radio"
          name="branchMode"
          checked={value === "stay"}
          onChange={() => onChange("stay")}
          style={{ accentColor: "var(--coral)" }}
        />
      </div>
    </div>
  );
}

// ── Section 4: Custom models ─────────────────────────────────────────────────

function slugify(s: string): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "model";
}

function CustomModelsSection({
  customModels,
  onChange,
}: {
  customModels: CustomModel[];
  onChange:     (next: CustomModel[]) => void;
}) {
  const [addOpen, setAddOpen]   = useState(false);
  const [name, setName]         = useState("");
  const [modelStr, setModelStr] = useState("");
  const [inPx, setInPx]         = useState("");
  const [outPx, setOutPx]       = useState("");

  const reset = () => {
    setName(""); setModelStr(""); setInPx(""); setOutPx("");
    setAddOpen(false);
  };

  const add = () => {
    const displayName = name.trim();
    const orId        = modelStr.trim();
    if (!displayName || !orId) return;
    const slug = slugify(displayName);
    const suffix = Math.random().toString(36).slice(2, 6);
    const m: CustomModel = {
      id:              `${slug}-${suffix}`,
      name:            displayName,
      openRouterId:    orId,
      inputPricePerM:  parseFloat(inPx)  || 0,
      outputPricePerM: parseFloat(outPx) || 0,
      vendor:          "",
      tag:             "custom",
      isCustom:        true,
    };
    onChange([...customModels, m]);
    reset();
  };

  const remove = (id: string) => {
    onChange(customModels.filter(c => c.id !== id));
  };

  const canSave = name.trim().length > 0 && modelStr.trim().length > 0;

  return (
    <div className="sm-section">
      <div className="sm-sub-h">
        <h4>Custom models</h4>
        <p>Any OpenRouter model string works. Prices are per million tokens.</p>
      </div>

      {customModels.length === 0 && !addOpen && (
        <div className="sm-empty">No custom models yet.</div>
      )}

      {customModels.map(m => (
        <div key={m.id} className="card-row sm-card-row">
          <div>
            <div className="cr-title">{m.name}<span className="sm-custom-tag"> · custom</span></div>
            <div className="cr-sub" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
              {m.openRouterId} · in ${m.inputPricePerM}/M · out ${m.outputPricePerM}/M
            </div>
          </div>
          <button
            className="icon-btn danger"
            onClick={() => remove(m.id)}
            title="Remove custom model"
          >
            Delete
          </button>
        </div>
      ))}

      {!addOpen ? (
        <button className="btn-outline sm-add-cta" onClick={() => setAddOpen(true)}>
          + Add custom model
        </button>
      ) : (
        <div className="custom-model-form">
          <div className="cmf-row">
            <div className="cmf-field">
              <label>Display name</label>
              <input
                placeholder="Claude Opus 4"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="cmf-field">
              <label>OpenRouter model string</label>
              <input
                placeholder="anthropic/claude-opus-4"
                value={modelStr}
                onChange={e => setModelStr(e.target.value)}
                style={{ fontFamily: "var(--mono)", fontSize: 13 }}
              />
            </div>
          </div>
          <div className="cmf-row">
            <div className="cmf-field">
              <label>Input $/M tokens</label>
              <input
                type="number" step="0.01" min="0"
                placeholder="3.30"
                value={inPx}
                onChange={e => setInPx(e.target.value)}
              />
            </div>
            <div className="cmf-field">
              <label>Output $/M tokens</label>
              <input
                type="number" step="0.01" min="0"
                placeholder="16.50"
                value={outPx}
                onChange={e => setOutPx(e.target.value)}
              />
            </div>
          </div>
          <div className="cmf-actions">
            <button className="btn-outline" onClick={reset}>Cancel</button>
            <button
              className="btn-primary coral"
              onClick={add}
              disabled={!canSave}
            >
              Add model
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section 5: Data ──────────────────────────────────────────────────────────

function DataSection({ onClearAll }: { onClearAll: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const doExport = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await exportAllChats();
      setStatus("Downloaded backup.");
    } catch (err) {
      setStatus(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await importFromJson(file);
      setStatus(`Imported ${res.chatsAdded} chat${res.chatsAdded === 1 ? "" : "s"}; ${res.skipped} skipped.`);
    } catch (err) {
      setStatus(`Import failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    if (confirmText !== "DELETE") return;
    setBusy(true);
    try {
      await db.transaction(
        "rw",
        [db.chats, db.nodes, db.messages, db.reflections, db.files],
        async () => {
          await db.chats.clear();
          await db.nodes.clear();
          await db.messages.clear();
          await db.reflections.clear();
          await db.files.clear();
        },
      );
      setConfirmOpen(false);
      setConfirmText("");
      onClearAll();
    } catch (err) {
      setStatus(`Clear failed: ${(err as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div className="sm-section">
      <div className="sm-section-h">
        <h3>Your data</h3>
        <p>Everything lives in this browser. Bring it with you, or wipe it.</p>
      </div>

      <div className="card-row sm-card-row">
        <div>
          <div className="cr-title">Export all chats</div>
          <div className="cr-sub">Download a JSON backup of chats, nodes, messages, reflections, and files.</div>
        </div>
        <button className="btn-outline" onClick={() => void doExport()} disabled={busy}>
          Export JSON
        </button>
      </div>

      <div className="card-row sm-card-row">
        <div>
          <div className="cr-title">Import from backup</div>
          <div className="cr-sub">Merge a JSON backup; existing chats are kept.</div>
        </div>
        <button
          className="btn-outline"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="card-row sm-card-row">
        <div>
          <div className="cr-title">Clear all data</div>
          <div className="cr-sub">Wipes IndexedDB and the API key. Cannot be undone.</div>
        </div>
        <button
          className="btn-outline danger-outline"
          onClick={() => { setConfirmOpen(true); setConfirmText(""); setStatus(null); }}
          disabled={busy}
        >
          Clear…
        </button>
      </div>

      {confirmOpen && (
        <div className="card-row sm-card-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <div className="cr-sub" style={{ color: "var(--coral)" }}>
            Type <strong>DELETE</strong> to confirm. This removes all chats and the API key.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              autoFocus
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="DELETE"
              style={{
                flex: 1, padding: "8px 12px",
                border: "1px solid var(--line)", borderRadius: "var(--radius-sm)",
                background: "var(--bg-3)", color: "var(--ink)",
                fontFamily: "var(--mono)", fontSize: 13, outline: "none",
              }}
            />
            <button
              className="btn-outline"
              onClick={() => { setConfirmOpen(false); setConfirmText(""); }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="btn-primary coral"
              onClick={() => void doClear()}
              disabled={busy || confirmText !== "DELETE"}
            >
              Wipe
            </button>
          </div>
        </div>
      )}

      {status && (
        <div className="card-row sm-card-row">
          <div className="cr-sub" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
            {status}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section 6: About ─────────────────────────────────────────────────────────

function AboutSection() {
  return (
    <div className="sm-section sm-about">
      <div className="sm-section-h">
        <h3>cogninode beta v0.1.0</h3>
        <p>Open source · MIT license · runs entirely in your browser.</p>
      </div>
      <div className="sm-about-links">
        <a href="https://github.com/rahulmohan/cogninode" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </div>
    </div>
  );
}
