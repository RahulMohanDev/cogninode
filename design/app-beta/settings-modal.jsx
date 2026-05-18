// settings-modal.jsx — Beta-only settings overlay.
// Reachable from sidebar footer "..." button or ⌃, (comma) shortcut.
// Replaces the standalone settings.html page used in the hosted variant.

const {
  MODELS, getModel, calculateCostUsd, formatCost,
  getApiKey, setApiKey, maskApiKey,
  loadCustomModels, saveCustomModels,
  initStore, clearStore,
} = window;

const PREF_KEY = "cogninode_prefs_beta";
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} };

// Storage usage estimate (StorageManager API; falls back to a localStorage byte sum).
const useStorageUsage = () => {
  const [usage, setUsage] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (navigator.storage?.estimate) {
          const e = await navigator.storage.estimate();
          if (!cancelled && e) setUsage({ used: e.usage || 0, quota: e.quota || 0 });
          return;
        }
      } catch (_) {}
      // Fallback: rough localStorage size in bytes
      let bytes = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          bytes += (k?.length || 0) + (localStorage.getItem(k)?.length || 0);
        }
      } catch (_) {}
      if (!cancelled) setUsage({ used: bytes * 2, quota: 5 * 1024 * 1024 }); // chars → utf16 bytes; 5MB typical
    })();
    return () => { cancelled = true; };
  }, []);
  return usage;
};
const fmtBytes = (b) => {
  if (b == null) return "—";
  if (b < 1024)        return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
};

// ──────────────────────────────────────────────────────────────────
// Section 1 — API key
// ──────────────────────────────────────────────────────────────────
const ApiKeySection = ({ apiKey, setApiKeyState, onRemoveKey }) => {
  const [reveal, setReveal] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [status, setStatus] = React.useState(null); // 'verifying' | 'ok' | { error }

  const save = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    // Light validation — OpenRouter keys start with sk-or-
    if (!trimmed.startsWith("sk-or-")) {
      setStatus({ error: "OpenRouter keys start with sk-or-…" });
      return;
    }
    setStatus("verifying");
    // No real network in the beta sandbox — simulate a short verification step.
    setTimeout(() => {
      setApiKey(trimmed);
      setApiKeyState(trimmed);
      setDraft("");
      setStatus("ok");
      window.dispatchEvent(new CustomEvent("cogninode:apikey-changed"));
      setTimeout(() => setStatus(null), 1800);
    }, 500);
  };

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
              ? (reveal ? apiKey : maskApiKey(apiKey))
              : <span className="api-key-empty">No key set</span>}
          </div>
        </div>
        <div className="sm-key-actions">
          <button
            className="icon-btn"
            disabled={!apiKey}
            onClick={() => setReveal(v => !v)}
            title={reveal ? "Hide" : "Reveal"}
          >
            {reveal ? (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M2 14 L14 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M5.5 11.5 a6 4.5 0 0 1 0 -7 a6 4.5 0 0 1 5 0 M11 5 a6 4.5 0 0 1 3 3 a6 4.5 0 0 1 -3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M2 8 a6 4.5 0 0 1 12 0 a6 4.5 0 0 1 -12 0 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
                <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.4" fill="none"/>
              </svg>
            )}
          </button>
          <button
            className="icon-btn danger"
            disabled={!apiKey}
            onClick={onRemoveKey}
            title="Remove key"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M3 5 H13 M6 5 V3 H10 V5 M5 5 V13 H11 V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="card-row sm-card-row sm-key-update">
        <div style={{ flex: 1 }}>
          <div className="cr-title">Update key</div>
          <div className="cr-sub">Paste a new OpenRouter key to replace the current one.</div>
        </div>
        <div className="sm-key-form">
          <input
            type="password"
            placeholder="sk-or-v1-..."
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setStatus(null); }}
            autoComplete="off"
            spellCheck="false"
          />
          <button className="btn-outline" onClick={save} disabled={!draft.trim() || status === "verifying"}>
            {status === "verifying" ? "Verifying…" : status === "ok" ? "Saved ✓" : "Verify & save"}
          </button>
        </div>
        {status && status.error && <div className="sm-error">{status.error}</div>}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────
// Section 2 — Models
// ──────────────────────────────────────────────────────────────────
const Toggle = ({ on, onChange }) => (
  <div className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}></div>
);

const ModelsSection = ({ prefs, update }) => {
  const [customs, setCustoms] = React.useState(() => loadCustomModels());
  const [addOpen, setAddOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", modelString: "", inputPrice: "", outputPrice: "" });

  const saveCustomsAndRefresh = (next) => {
    saveCustomModels(next);
    setCustoms(next);
    window.dispatchEvent(new CustomEvent("cogninode:models-changed"));
  };

  const addCustom = () => {
    if (!form.name.trim() || !form.modelString.trim()) return;
    const id = "custom_" + Math.random().toString(36).slice(2, 8);
    const m = {
      id,
      name: form.name.trim(),
      modelString: form.modelString.trim(),
      vendor: "Custom",
      tag: "user-added",
      tier: 3,
      inputPricePerMTokenUsd:  parseFloat(form.inputPrice)  || 0,
      outputPricePerMTokenUsd: parseFloat(form.outputPrice) || 0,
      color: "#5b6470",
      initials: form.name.trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "??",
      custom: true,
    };
    saveCustomsAndRefresh([...customs, m]);
    setForm({ name: "", modelString: "", inputPrice: "", outputPrice: "" });
    setAddOpen(false);
  };

  const removeCustom = (id) => {
    saveCustomsAndRefresh(customs.filter(c => c.id !== id));
  };

  const renderRow = (m) => (
    <div key={m.id} className="card-row sm-card-row">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="m-dot" style={{ width: 30, height: 30, borderRadius: "50%", background: m.color, color: "white", display: "grid", placeItems: "center", fontFamily: "var(--mono)", fontWeight: 700, fontSize: 11, letterSpacing: "-0.04em" }}>
          {m.initials}
        </span>
        <div>
          <div className="cr-title">{m.name}{m.custom && <span className="sm-custom-tag"> · custom</span>}</div>
          <div className="cr-sub">{m.vendor} · {m.tag}{m.modelString ? ` · ${m.modelString}` : ""}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="sm-cost-badge">
          {calculateCostUsd(1200, 600, m) === 0 ? "free" : formatCost(calculateCostUsd(1200, 600, m)) + " / std msg"}
        </span>
        <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="radio"
            name="defaultModel"
            checked={prefs.defaultModel === m.id}
            onChange={() => update({ defaultModel: m.id })}
            style={{ accentColor: "var(--coral)" }}
          />
          <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Default</span>
        </label>
        {m.custom && (
          <button
            className="icon-btn danger"
            onClick={() => removeCustom(m.id)}
            title="Remove custom model"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 5 H13 M6 5 V3 H10 V5 M5 5 V13 H11 V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="sm-section">
      <div className="sm-section-h">
        <h3>Default model</h3>
        <p>Used for new messages. "Std msg" = 1,200 input + 600 output tokens.</p>
      </div>
      {MODELS.map(renderRow)}

      <div className="sm-sub-h">
        <h4>Custom models</h4>
        <p>Any OpenRouter model string works. Prices are per million tokens.</p>
      </div>
      {customs.map(renderRow)}
      {customs.length === 0 && !addOpen && (
        <div className="sm-empty">No custom models yet.</div>
      )}

      {!addOpen ? (
        <button className="btn-outline sm-add-cta" onClick={() => setAddOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M8 3 V13 M3 8 H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          Add custom model
        </button>
      ) : (
        <div className="custom-model-form">
          <div className="cmf-row">
            <div className="cmf-field">
              <label>Display name</label>
              <input
                placeholder="Claude Opus 4"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="cmf-field">
              <label>OpenRouter model string</label>
              <input
                placeholder="anthropic/claude-opus-4"
                value={form.modelString}
                onChange={(e) => setForm({ ...form, modelString: e.target.value })}
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
                value={form.inputPrice}
                onChange={(e) => setForm({ ...form, inputPrice: e.target.value })}
              />
            </div>
            <div className="cmf-field">
              <label>Output $/M tokens</label>
              <input
                type="number" step="0.01" min="0"
                placeholder="16.50"
                value={form.outputPrice}
                onChange={(e) => setForm({ ...form, outputPrice: e.target.value })}
              />
            </div>
          </div>
          <div className="cmf-actions">
            <button className="btn-outline" onClick={() => setAddOpen(false)}>Cancel</button>
            <button className="btn-primary coral" onClick={addCustom} disabled={!form.name.trim() || !form.modelString.trim()}>
              Add model
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────
// Section 3 — Data
// ──────────────────────────────────────────────────────────────────
const DataSection = () => {
  const usage = useStorageUsage();
  const pct = usage && usage.quota
    ? Math.min(100, (usage.used / usage.quota) * 100)
    : 0;
  const fileRef = React.useRef(null);

  const exportJson = () => {
    try {
      const dump = {
        version: 1,
        exportedAt: new Date().toISOString(),
        store: JSON.parse(localStorage.getItem("cogninode_v1") || "null"),
        prefs: JSON.parse(localStorage.getItem(PREF_KEY) || "null"),
        customModels: loadCustomModels(),
      };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cogninode-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert("Export failed: " + e.message);
    }
  };

  const importJson = (file) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (data.store) localStorage.setItem("cogninode_v1", JSON.stringify(data.store));
        if (data.prefs) localStorage.setItem(PREF_KEY, JSON.stringify(data.prefs));
        if (data.customModels) saveCustomModels(data.customModels);
        alert("Imported. Reload the page to see merged data.");
      } catch (e) {
        alert("Import failed: " + e.message);
      }
    };
    r.readAsText(file);
  };

  const clearAll = () => {
    if (!confirm("Clear ALL chats, prefs, custom models, and the API key? Cannot be undone.")) return;
    clearStore();
    try {
      localStorage.removeItem(PREF_KEY);
      localStorage.removeItem("cogninode_custom_models");
      localStorage.removeItem("cogninode_openrouter_key");
    } catch (_) {}
    window.location.href = "setup.html";
  };

  return (
    <div className="sm-section">
      <div className="sm-section-h">
        <h3>Your data</h3>
        <p>Everything lives in this browser. Bring it with you, or wipe it.</p>
      </div>

      <div className="card-row sm-card-row">
        <div style={{ flex: 1 }}>
          <div className="cr-title">Storage used</div>
          <div className="storage-bar"><span style={{ width: pct + "%" }}></span></div>
          <div className="cr-sub sm-storage-meta">
            {usage ? `${fmtBytes(usage.used)} of ~${fmtBytes(usage.quota)}` : "calculating…"}
          </div>
        </div>
      </div>

      <div className="card-row sm-card-row">
        <div>
          <div className="cr-title">Export all chats</div>
          <div className="cr-sub">Download a JSON backup of chats, prefs, and custom models.</div>
        </div>
        <button className="btn-outline" onClick={exportJson}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M8 2 V11 M4 7 L8 11 L12 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3 13 H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Export JSON
        </button>
      </div>

      <div className="card-row sm-card-row">
        <div>
          <div className="cr-title">Import from backup</div>
          <div className="cr-sub">Merge a JSON backup into your current data.</div>
        </div>
        <button className="btn-outline" onClick={() => fileRef.current?.click()}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M8 13 V4 M4 8 L8 4 L12 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3 13 H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.[0]) importJson(e.target.files[0]); e.target.value = ""; }}
        />
      </div>

      <div className="card-row sm-card-row">
        <div>
          <div className="cr-title">Clear all data</div>
          <div className="cr-sub">Wipe localStorage. Cannot be undone.</div>
        </div>
        <button className="btn-outline danger-outline" onClick={clearAll}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M3 5 H13 M6 5 V3 H10 V5 M5 5 V13 H11 V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Clear
        </button>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────
// Section 4 — About
// ──────────────────────────────────────────────────────────────────
const AboutSection = () => (
  <div className="sm-section sm-about">
    <div className="sm-section-h">
      <h3>cogninode beta</h3>
      <p>Open source · MIT license · runs entirely in your browser.</p>
    </div>
    <div className="sm-about-links">
      <a href="https://github.com/" target="_blank" rel="noopener noreferrer">
        GitHub
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path d="M5 11 L11 5 M6 5 H11 V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </a>
      <a href="https://github.com/" target="_blank" rel="noopener noreferrer">
        Report an issue
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path d="M5 11 L11 5 M6 5 H11 V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </a>
    </div>
  </div>
);

// ──────────────────────────────────────────────────────────────────
// The modal shell
// ──────────────────────────────────────────────────────────────────
const SettingsModal = ({ onClose, focusSection }) => {
  const [apiKey, setApiKeyState] = React.useState(() => getApiKey());
  const [prefs, setPrefs] = React.useState(() => ({
    defaultModel: "flash",
    ...loadPrefs(),
  }));
  const update = (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  const modelsRef = React.useRef(null);

  React.useEffect(() => {
    if (focusSection === "models" && modelsRef.current) {
      // Defer to next frame so the popIn animation can settle first
      setTimeout(() => modelsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }, [focusSection]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleRemoveKey = () => {
    if (!confirm("Remove API key? You'll be returned to setup.")) return;
    setApiKey("");
    window.dispatchEvent(new CustomEvent("cogninode:apikey-changed"));
    window.location.href = "setup.html";
  };

  return (
    <div className="qj-overlay sm-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sm-head">
          <span className="sm-head-icon">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M8 1 V3 M8 13 V15 M1 8 H3 M13 8 H15 M3 3 L4.5 4.5 M11.5 11.5 L13 13 M3 13 L4.5 11.5 M11.5 4.5 L13 3"
                    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </span>
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="sm-body">
          <ApiKeySection apiKey={apiKey} setApiKeyState={setApiKeyState} onRemoveKey={handleRemoveKey}/>
          <div ref={modelsRef}>
            <ModelsSection prefs={prefs} update={update}/>
          </div>
          <DataSection/>
          <AboutSection/>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { SettingsModal });
