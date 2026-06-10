// src/components/settings/SettingsModal.tsx
// Settings modal: API key, default model, branch mode, custom models CRUD,
// data export/import/clear, and about. Returns null when closed.

import { useMemo, useRef, useState } from "react";

import { db } from "../../lib/db";
import {
  formatCost,
  calculateCostUsd,
  type CustomModel,
} from "../../lib/cost";
import { exportAllChats, importFromJson } from "../../lib/export";
import { useSettings } from "../../hooks/useSettings";
import { useModalBehavior } from "../../hooks/useModalStack";
import { useModels } from "../../hooks/ModelsProvider";
import { useSearchState, semanticStatusLabel } from "../../hooks/useSearchState";
import { searchService } from "../../lib/search/service";
import { EMBEDDING_MODELS } from "../../lib/search/embedding/models";
import { useToast } from "../ui/Toast";

export interface SettingsModalProps {
  open:    boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  // Esc-to-close, focus restore, and Tab containment via the shared modal
  // stack — Settings sits at z-210 so it stays above the z-200 overlays and
  // Esc unwinds the topmost layer only.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalBehavior(open, onClose, panelRef);

  const { apiKey, clearApiKey, prefs, setPref, setTheme } = useSettings();

  if (!open) return null;

  return (
    <div className="tw:fixed tw:inset-0 tw:bg-[color-mix(in_oklab,var(--ink)_30%,transparent)] tw:dark:bg-[var(--veil-black-60)] tw:backdrop-blur-[8px] tw:grid tw:[place-items:start_center] tw:pt-[8vh] tw:z-[210] tw:animate-[fadeIn_0.14s_ease-out]" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Settings" className="tw:w-[min(640px,92vw)] tw:bg-bg-3 tw:border tw:border-line tw:rounded-app tw:shadow-3 tw:overflow-hidden tw:flex tw:flex-col tw:max-h-[84vh] tw:animate-[popUp_0.18s_cubic-bezier(0.34,1.56,0.64,1)]" onClick={e => e.stopPropagation()}>
        <div className="tw:flex tw:items-center tw:gap-2.5 tw:py-3.5 tw:px-[18px] tw:border-b tw:border-line tw:bg-bg-3">
          <span className="tw:text-ink-3 tw:grid tw:place-items-center">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M8 1 V3 M8 13 V15 M1 8 H3 M13 8 H15 M3 3 L4.5 4.5 M11.5 11.5 L13 13 M3 13 L4.5 11.5 M11.5 4.5 L13 3"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
              />
            </svg>
          </span>
          <h2 className="tw:flex-1 tw:m-0 tw:font-display tw:font-semibold tw:text-[18px] tw:tracking-[-0.015em] tw:text-ink">Settings</h2>
          <button className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink" onClick={onClose} title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="sm-body tw:flex-1 tw:overflow-y-auto tw:pt-1 tw:px-5 tw:pb-5 tw:[scrollbar-width:thin] tw:[scrollbar-color:var(--line)_transparent]">
          <ApiKeySection
            apiKey={apiKey}
            onRemoveKey={() => { clearApiKey(); onClose(); }}
          />

          <ModelSection
            customModels={prefs.customModels}
            defaultModelId={prefs.defaultModelId}
            onSelectDefault={id => setPref("defaultModelId", id)}
          />

          <CatalogSection />

          <SearchSection
            semanticSearch={prefs.semanticSearch}
            embeddingModelId={prefs.embeddingModelId}
            onToggle={v => setPref("semanticSearch", v)}
            onSelectModel={id => setPref("embeddingModelId", id)}
          />

          <BranchModeSection
            value={prefs.branchMode}
            onChange={v => setPref("branchMode", v)}
          />

          <ThemeSection
            value={prefs.theme}
            onChange={mode => setTheme(mode)}
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
    <div className="tw:py-[18px] tw:px-0 tw:border-t tw:border-line tw:first:border-t-0">
      <div className="tw:mb-2">
        <h3 className="tw:m-0 tw:font-display tw:font-semibold tw:text-[16px] tw:tracking-[-0.01em] tw:text-ink">OpenRouter API key</h3>
        <p className="tw:mt-0.5 tw:mx-0 tw:mb-0 tw:text-[12px] tw:text-ink-3">Stored in localStorage on this device only.</p>
      </div>

      <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
        <div className="tw:flex-1 tw:min-w-0">
          <div className="tw:font-medium tw:text-[14px] tw:text-ink">Current key</div>
          <div className="tw:font-mono tw:text-[12px] tw:text-ink-2 tw:bg-bg-2 tw:py-[5px] tw:px-2.5 tw:rounded-app-xs tw:inline-block tw:max-w-full tw:truncate tw:mt-1">
            {apiKey
              ? (reveal ? apiKey : masked)
              : <span className="tw:text-ink-3 tw:italic">No key set</span>}
          </div>
        </div>
        <div className="tw:flex tw:gap-1">
          <button
            className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-bg-2 tw:hover:text-ink tw:disabled:opacity-35 tw:disabled:cursor-not-allowed"
            disabled={!apiKey}
            onClick={() => setReveal(v => !v)}
            title={reveal ? "Hide key" : "Reveal key"}
          >
            {reveal ? "Hide" : "Reveal"}
          </button>
          <button
            className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-coral-tint tw:hover:text-coral tw:disabled:opacity-35 tw:disabled:cursor-not-allowed"
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
// With the live catalog (~340 models) a flat radio list stopped scaling:
// the section now shows pinned models by default and searches the whole
// catalog as you type.

const MODEL_ROWS_CAP = 12;

function ModelSection({
  customModels,
  defaultModelId,
  onSelectDefault,
}: {
  customModels:    CustomModel[];
  defaultModelId:  string;
  onSelectDefault: (id: string) => void;
}) {
  const { models, resolve, pinnedIds } = useModels();
  const [q, setQ] = useState("");

  const current = resolve(defaultModelId);
  const customIds = useMemo(() => new Set(customModels.map(c => c.id)), [customModels]);

  const { rows, overflow } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle) {
      const hits = models.filter(m =>
        m.name.toLowerCase().includes(needle) ||
        m.id.toLowerCase().includes(needle) ||
        m.vendor.toLowerCase().includes(needle));
      return { rows: hits.slice(0, MODEL_ROWS_CAP), overflow: Math.max(0, hits.length - MODEL_ROWS_CAP) };
    }
    const pinnedSet = new Set(pinnedIds);
    const pinned = models.filter(m => pinnedSet.has(m.id));
    // Keep the current default visible even when it isn't pinned.
    if (current && !pinnedSet.has(current.id)) pinned.unshift(current);
    return { rows: pinned, overflow: 0 };
  }, [models, q, pinnedIds, current]);

  return (
    <div className="tw:py-[18px] tw:px-0 tw:border-t tw:border-line tw:first:border-t-0">
      <div className="tw:mb-2">
        <h3 className="tw:m-0 tw:font-display tw:font-semibold tw:text-[16px] tw:tracking-[-0.01em] tw:text-ink">Default model</h3>
        <p className="tw:mt-0.5 tw:mx-0 tw:mb-0 tw:text-[12px] tw:text-ink-3">
          Used for new messages. "Std msg" ≈ 1,200 in + 600 out tokens.
          {q.trim() === "" && " Showing pinned models — search to browse the full catalog."}
        </p>
      </div>

      <input
        className="tw:w-full tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[13px] tw:outline-none tw:bg-bg tw:text-ink tw:transition-[border-color] tw:duration-[120ms] tw:ease-[ease] tw:focus:border-ink-3 tw:placeholder:text-ink-3 tw:mb-1"
        type="text"
        placeholder="Search models by name, id, or vendor…"
        value={q}
        onChange={e => setQ(e.target.value)}
        spellCheck={false}
      />

      {rows.map(m => {
        const stdCost = calculateCostUsd(1200, 600, m);
        const isCustom = customIds.has(m.id);
        return (
          <div key={m.id} className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
            <div className="tw:min-w-0">
              <div className="tw:font-medium tw:text-[14px] tw:text-ink tw:truncate">
                {m.name}
                {isCustom && <span className="tw:font-mono tw:text-[10px] tw:tracking-[0.08em] tw:uppercase tw:text-ink-3 tw:ml-1"> · custom</span>}
              </div>
              <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5 tw:truncate">{m.vendor || "—"} · {m.tag}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="tw:font-mono tw:text-[11px] tw:bg-bg-2 tw:py-[3px] tw:px-2 tw:rounded-[999px] tw:text-ink-2 tw:tracking-[0.02em]">
                {stdCost === 0 ? "free" : `${formatCost(stdCost)} / std msg`}
              </span>
              <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="defaultModel"
                  checked={defaultModelId === m.id || current?.id === m.id}
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

      {overflow > 0 && (
        <div className="tw:py-2 tw:text-[12px] tw:text-ink-3 tw:text-center">+{overflow} more — keep typing to narrow.</div>
      )}
      {rows.length === 0 && (
        <div className="tw:py-3 tw:text-[13px] tw:text-ink-3 tw:text-center tw:italic">No models match "{q}".</div>
      )}
    </div>
  );
}

// ── Section 2b: Live catalog ─────────────────────────────────────────────────

function catalogAge(ts: number | null): string {
  if (!ts) return "never";
  const min = Math.floor((Date.now() - ts) / 60_000);
  if (min < 1)  return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function CatalogSection() {
  const { catalogCount, fetchedAt, refreshing, refresh } = useModels();
  const toast = useToast();

  const doRefresh = async (): Promise<void> => {
    try {
      const { count } = await refresh();
      toast(`Model catalog updated — ${count} models`, { kind: "success" });
    } catch (err) {
      toast(`Catalog refresh failed: ${(err as Error).message}`, { kind: "error" });
    }
  };

  return (
    <div className="tw:py-[18px] tw:px-0 tw:border-t tw:border-line tw:first:border-t-0">
      <div className="tw:mb-2">
        <h3 className="tw:m-0 tw:font-display tw:font-semibold tw:text-[16px] tw:tracking-[-0.01em] tw:text-ink">Model catalog</h3>
        <p className="tw:mt-0.5 tw:mx-0 tw:mb-0 tw:text-[12px] tw:text-ink-3">
          Fetched live from OpenRouter (no key needed) and cached locally. Refreshes automatically once a day.
        </p>
      </div>

      <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
        <div>
          <div className="tw:font-medium tw:text-[14px] tw:text-ink">
            {catalogCount > 0 ? `${catalogCount} models available` : "Using built-in fallback list"}
          </div>
          <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5">
            {catalogCount > 0
              ? `Last updated ${catalogAge(fetchedAt)} · live pricing & context windows`
              : "Couldn't reach OpenRouter yet — refresh to fetch the live catalog."}
          </div>
        </div>
        <button
          className="tw:bg-bg-3 tw:text-ink tw:py-[11px] tw:px-[18px] tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:border-line tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:border-ink-3 tw:disabled:opacity-50 tw:disabled:cursor-not-allowed"
          onClick={() => void doRefresh()}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

// ── Section 2c: Search ───────────────────────────────────────────────────────
// Keyword search is always on (in-memory BM25, no downloads). This section
// controls the optional semantic layer: which embedding model runs locally,
// and the kill switch that deletes vectors + cached weights.

function SearchSection({
  semanticSearch,
  embeddingModelId,
  onToggle,
  onSelectModel,
}: {
  semanticSearch:   boolean;
  embeddingModelId: string;
  onToggle:         (v: boolean) => void;
  onSelectModel:    (id: string) => void;
}) {
  const searchState = useSearchState();
  const toast = useToast();

  const disable = (): void => {
    onToggle(false);
    void searchService.purgeSemanticData().then(() => {
      toast("Semantic search off — vectors and model weights deleted", { kind: "info" });
    });
  };

  return (
    <div className="tw:py-[18px] tw:px-0 tw:border-t tw:border-line tw:first:border-t-0">
      <div className="tw:mb-2">
        <h3 className="tw:m-0 tw:font-display tw:font-semibold tw:text-[16px] tw:tracking-[-0.01em] tw:text-ink">Search</h3>
        <p className="tw:mt-0.5 tw:mx-0 tw:mb-0 tw:text-[12px] tw:text-ink-3">
          Keyword search (⌘K) is always on and instant. Semantic search runs a small
          embedding model in your browser so results also match by <em>meaning</em>.
        </p>
      </div>

      <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
        <div>
          <div className="tw:font-medium tw:text-[14px] tw:text-ink">Semantic search</div>
          <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5">
            {semanticSearch
              ? <>Status: <span className="tw:font-mono tw:text-[12px]">{semanticStatusLabel(searchState)}</span>
                  {searchState.semantic === "ready" && ` · ${searchState.vectorCount} items embedded`}
                  {searchState.semantic === "error" && searchState.error ? ` — ${searchState.error}` : ""}</>
              : "Off — turning it on downloads the model below in the background."}
          </div>
        </div>
        {semanticSearch ? (
          <button
            className="tw:bg-bg-3 tw:py-[11px] tw:px-[18px] tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:border-coral tw:text-coral tw:hover:bg-coral-tint"
            onClick={disable}
            title="Stops semantic search and deletes embeddings + downloaded model weights"
          >
            Turn off
          </button>
        ) : (
          <button
            className="tw:bg-bg-3 tw:text-ink tw:py-[11px] tw:px-[18px] tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:border-line tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:border-ink-3"
            onClick={() => onToggle(true)}
          >
            Turn on
          </button>
        )}
      </div>

      {EMBEDDING_MODELS.map(m => (
        <div key={m.id} className={`tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0 ${semanticSearch ? "" : "tw:opacity-50"}`}>
          <div>
            <div className="tw:font-medium tw:text-[14px] tw:text-ink">
              {m.label}
              <span className="tw:font-mono tw:text-[10px] tw:tracking-[0.08em] tw:uppercase tw:text-ink-3 tw:ml-1"> · {m.sizeLabel}</span>
            </div>
            <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5">{m.note}</div>
          </div>
          <input
            type="radio"
            name="embeddingModel"
            checked={embeddingModelId === m.id}
            disabled={!semanticSearch}
            onChange={() => onSelectModel(m.id)}
            style={{ accentColor: "var(--lilac)" }}
          />
        </div>
      ))}
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
    <div className="tw:py-[18px] tw:px-0 tw:border-t tw:border-line tw:first:border-t-0">
      <div className="tw:mb-2">
        <h3 className="tw:m-0 tw:font-display tw:font-semibold tw:text-[16px] tw:tracking-[-0.01em] tw:text-ink">Branch behaviour</h3>
        <p className="tw:mt-0.5 tw:mx-0 tw:mb-0 tw:text-[12px] tw:text-ink-3">What happens after you branch from a selection.</p>
      </div>

      <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
        <div>
          <div className="tw:font-medium tw:text-[14px] tw:text-ink">Follow new branch</div>
          <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5">Jump to the freshly created branch automatically.</div>
        </div>
        <input
          type="radio"
          name="branchMode"
          checked={value === "follow"}
          onChange={() => onChange("follow")}
          style={{ accentColor: "var(--coral)" }}
        />
      </div>

      <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
        <div>
          <div className="tw:font-medium tw:text-[14px] tw:text-ink">Stay on current node</div>
          <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5">Keep your place; branch is created in the background.</div>
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

// ── Section 3b: Theme ────────────────────────────────────────────────────────

function ThemeSection({
  value,
  onChange,
}: {
  value:    "light" | "dark";
  onChange: (v: "light" | "dark") => void;
}) {
  return (
    <div className="tw:py-[18px] tw:px-0 tw:border-t tw:border-line tw:first:border-t-0">
      <div className="tw:mb-2">
        <h3 className="tw:m-0 tw:font-display tw:font-semibold tw:text-[16px] tw:tracking-[-0.01em] tw:text-ink">Theme</h3>
        <p className="tw:mt-0.5 tw:mx-0 tw:mb-0 tw:text-[12px] tw:text-ink-3">Reading-by-lamplight dark, or warm cream light.</p>
      </div>

      <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
        <div>
          <div className="tw:font-medium tw:text-[14px] tw:text-ink">Light</div>
          <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5">Warm cream surfaces with espresso ink.</div>
        </div>
        <input
          type="radio"
          name="theme"
          checked={value === "light"}
          onChange={() => onChange("light")}
          style={{ accentColor: "var(--coral)" }}
        />
      </div>

      <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
        <div>
          <div className="tw:font-medium tw:text-[14px] tw:text-ink">Dark</div>
          <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5">Low-glare ink with cream type. Default.</div>
        </div>
        <input
          type="radio"
          name="theme"
          checked={value === "dark"}
          onChange={() => onChange("dark")}
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
    <div className="tw:py-[18px] tw:px-0 tw:border-t tw:border-line tw:first:border-t-0">
      <div className="tw:mt-[18px] tw:mx-0 tw:mb-1.5 tw:pt-3.5 tw:border-t tw:border-dashed tw:border-line-2">
        <h4 className="tw:m-0 tw:font-mono tw:text-[10px] tw:tracking-[0.14em] tw:uppercase tw:text-ink-3 tw:font-medium">Custom models</h4>
        <p className="tw:mt-1 tw:mx-0 tw:mb-0 tw:text-[12px] tw:text-ink-3">Any OpenRouter model string works. Prices are per million tokens.</p>
      </div>

      {customModels.length === 0 && !addOpen && (
        <div className="tw:p-3.5 tw:text-[13px] tw:text-ink-3 tw:bg-bg tw:border tw:border-dashed tw:border-line tw:rounded-app-sm tw:text-center tw:italic">No custom models yet.</div>
      )}

      {customModels.map(m => (
        <div key={m.id} className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
          <div>
            <div className="tw:font-medium tw:text-[14px] tw:text-ink">{m.name}<span className="tw:font-mono tw:text-[10px] tw:tracking-[0.08em] tw:uppercase tw:text-ink-3 tw:ml-1"> · custom</span></div>
            <div className="tw:text-ink-3 tw:mt-0.5 tw:font-mono tw:text-[12px]">
              {m.openRouterId} · in ${m.inputPricePerM}/M · out ${m.outputPricePerM}/M
            </div>
          </div>
          <button
            className="tw:w-[30px] tw:h-[30px] tw:grid tw:place-items-center tw:rounded-[8px] tw:text-ink-2 tw:transition-[background-color,color] tw:duration-[120ms] tw:ease-[ease] tw:hover:bg-coral-tint tw:hover:text-coral"
            onClick={() => remove(m.id)}
            title="Remove custom model"
          >
            Delete
          </button>
        </div>
      ))}

      {!addOpen ? (
        <button className="tw:bg-bg-3 tw:text-ink tw:py-[11px] tw:px-[18px] tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:border-line tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:border-ink-3 tw:mt-3.5 tw:w-full tw:justify-center" onClick={() => setAddOpen(true)}>
          + Add custom model
        </button>
      ) : (
        <div className="tw:mt-3.5 tw:p-4 tw:bg-bg tw:border tw:border-line tw:rounded-app-sm tw:flex tw:flex-col tw:gap-2.5">
          <div className="tw:grid tw:grid-cols-2 tw:gap-2.5">
            <div className="tw:flex tw:flex-col tw:gap-1">
              <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">Display name</label>
              <input
                className="tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[13px] tw:outline-none tw:bg-bg-3 tw:text-ink tw:transition-[border-color] tw:duration-[120ms] tw:ease-[ease] tw:focus:border-ink-3"
                placeholder="Claude Opus 4"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="tw:flex tw:flex-col tw:gap-1">
              <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">OpenRouter model string</label>
              <input
                className="tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[13px] tw:outline-none tw:bg-bg-3 tw:text-ink tw:transition-[border-color] tw:duration-[120ms] tw:ease-[ease] tw:focus:border-ink-3"
                placeholder="anthropic/claude-opus-4"
                value={modelStr}
                onChange={e => setModelStr(e.target.value)}
                style={{ fontFamily: "var(--mono)", fontSize: 13 }}
              />
            </div>
          </div>
          <div className="tw:grid tw:grid-cols-2 tw:gap-2.5">
            <div className="tw:flex tw:flex-col tw:gap-1">
              <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">Input $/M tokens</label>
              <input
                className="tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[13px] tw:outline-none tw:bg-bg-3 tw:text-ink tw:transition-[border-color] tw:duration-[120ms] tw:ease-[ease] tw:focus:border-ink-3"
                type="number" step="0.01" min="0"
                placeholder="3.30"
                value={inPx}
                onChange={e => setInPx(e.target.value)}
              />
            </div>
            <div className="tw:flex tw:flex-col tw:gap-1">
              <label className="tw:font-mono tw:text-[10px] tw:tracking-[0.12em] tw:uppercase tw:text-ink-3">Output $/M tokens</label>
              <input
                className="tw:py-2 tw:px-3 tw:border tw:border-line tw:rounded-app-sm tw:text-[13px] tw:outline-none tw:bg-bg-3 tw:text-ink tw:transition-[border-color] tw:duration-[120ms] tw:ease-[ease] tw:focus:border-ink-3"
                type="number" step="0.01" min="0"
                placeholder="16.50"
                value={outPx}
                onChange={e => setOutPx(e.target.value)}
              />
            </div>
          </div>
          <div className="tw:flex tw:gap-2 tw:justify-end tw:mt-1">
            <button className="tw:bg-bg-3 tw:text-ink tw:py-2 tw:px-4 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:border tw:border-line tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:border-ink-3" onClick={reset}>Cancel</button>
            <button
              className="tw:bg-coral tw:text-bg tw:py-2 tw:px-4 tw:rounded-app-sm tw:text-[13px] tw:font-medium tw:w-full tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:bg-[#ff4520] tw:dark:hover:bg-[color-mix(in_oklab,var(--ink)_88%,var(--bg))]"
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
    <div className="tw:py-[18px] tw:px-0 tw:border-t tw:border-line tw:first:border-t-0">
      <div className="tw:mb-2">
        <h3 className="tw:m-0 tw:font-display tw:font-semibold tw:text-[16px] tw:tracking-[-0.01em] tw:text-ink">Your data</h3>
        <p className="tw:mt-0.5 tw:mx-0 tw:mb-0 tw:text-[12px] tw:text-ink-3">Everything lives in this browser. Bring it with you, or wipe it.</p>
      </div>

      <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
        <div>
          <div className="tw:font-medium tw:text-[14px] tw:text-ink">Export all chats</div>
          <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5">Download a JSON backup of chats, nodes, messages, reflections, and files.</div>
        </div>
        <button className="tw:bg-bg-3 tw:text-ink tw:py-[11px] tw:px-[18px] tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:border-line tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:border-ink-3" onClick={() => void doExport()} disabled={busy}>
          Export JSON
        </button>
      </div>

      <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
        <div>
          <div className="tw:font-medium tw:text-[14px] tw:text-ink">Import from backup</div>
          <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5">Merge a JSON backup; existing chats are kept.</div>
        </div>
        <button
          className="tw:bg-bg-3 tw:text-ink tw:py-[11px] tw:px-[18px] tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:border-line tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:border-ink-3"
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

      <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
        <div>
          <div className="tw:font-medium tw:text-[14px] tw:text-ink">Clear all data</div>
          <div className="tw:text-ink-3 tw:text-[13px] tw:mt-0.5">Wipes IndexedDB and the API key. Cannot be undone.</div>
        </div>
        <button
          className="tw:bg-bg-3 tw:py-[11px] tw:px-[18px] tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:border-coral tw:text-coral tw:hover:bg-coral-tint"
          onClick={() => { setConfirmOpen(true); setConfirmText(""); setStatus(null); }}
          disabled={busy}
        >
          Clear…
        </button>
      </div>

      {confirmOpen && (
        <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <div className="tw:text-[13px] tw:mt-0.5 tw:text-coral">
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
              className="tw:bg-bg-3 tw:text-ink tw:py-[11px] tw:px-[18px] tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:border tw:border-line tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:border-ink-3"
              onClick={() => { setConfirmOpen(false); setConfirmText(""); }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="tw:bg-coral tw:text-bg tw:py-3 tw:px-5 tw:rounded-app-sm tw:text-[14px] tw:font-medium tw:w-full tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:hover:bg-[#ff4520] tw:dark:hover:bg-[color-mix(in_oklab,var(--ink)_88%,var(--bg))]"
              onClick={() => void doClear()}
              disabled={busy || confirmText !== "DELETE"}
            >
              Wipe
            </button>
          </div>
        </div>
      )}

      {status && (
        <div className="tw:grid tw:grid-cols-[1fr_auto] tw:items-center tw:gap-4 tw:py-3 tw:px-0 tw:border-b tw:border-line-2 tw:last:border-b-0">
          <div className="tw:text-ink-3 tw:mt-0.5 tw:font-mono tw:text-[12px]">
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
    <div className="tw:py-[18px] tw:px-0 tw:border-t tw:border-line tw:first:border-t-0">
      <div className="tw:mb-2">
        <h3 className="tw:m-0 tw:font-display tw:font-semibold tw:text-[16px] tw:tracking-[-0.01em] tw:text-ink">cogninode beta v0.1.0</h3>
        <p className="tw:mt-0.5 tw:mx-0 tw:mb-0 tw:text-[12px] tw:text-ink-3">Open source · MIT license · runs entirely in your browser.</p>
      </div>
      <div className="tw:flex tw:gap-[18px] tw:mt-2.5">
        <a className="tw:inline-flex tw:items-center tw:gap-[5px] tw:text-[13px] tw:text-ink-3 tw:transition-[color] tw:duration-[120ms] tw:ease-[ease] tw:hover:text-ink" href="https://github.com/rahulmohan/cogninode" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </div>
    </div>
  );
}
