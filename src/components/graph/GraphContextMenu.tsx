// src/components/graph/GraphContextMenu.tsx
// Right-click menu for the graph canvas — one generic positioned list,
// fed different items for pane / node / edge targets. Fixed-positioned at
// the cursor with a full-screen transparent backdrop for click-away;
// Esc closes via the backdrop's key handling in GraphCanvas.

export interface MenuItem {
  label:   string;
  hint?:   string;
  danger?: boolean;
  onClick: () => void;
}

export function GraphContextMenu({
  x, y, items, onClose,
}: {
  x:       number;
  y:       number;
  items:   MenuItem[];
  onClose: () => void;
}) {
  if (items.length === 0) return null;
  // Keep the menu on-screen near the edges.
  const left = Math.min(x, window.innerWidth - 230);
  const top  = Math.min(y, window.innerHeight - (items.length * 34 + 16));

  return (
    <div
      className="tw:fixed tw:inset-0 tw:z-[180]"
      onClick={onClose}
      onContextMenu={e => { e.preventDefault(); onClose(); }}
    >
      <div
        className="tw:fixed tw:w-[210px] tw:bg-bg-3 tw:border tw:border-line tw:rounded-[12px] tw:shadow-3 tw:p-1 tw:animate-[popUp_0.12s_cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ left, top }}
        onClick={e => e.stopPropagation()}
        role="menu"
      >
        {items.map((item, i) => (
          <button
            key={i}
            className={`tw:w-full tw:flex tw:items-center tw:gap-2 tw:text-left tw:py-[7px] tw:px-2.5 tw:rounded-[8px] tw:text-[12.5px] ${item.danger ? "tw:text-coral tw:hover:bg-[color-mix(in_oklab,var(--coral)_14%,transparent)]" : "tw:text-ink tw:hover:bg-bg-2"}`}
            onClick={() => { item.onClick(); onClose(); }}
            role="menuitem"
          >
            <span className="tw:flex-1 tw:min-w-0 tw:truncate">{item.label}</span>
            {item.hint && (
              <span className="tw:font-mono tw:text-[9px] tw:text-ink-4 tw:flex-none">{item.hint}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default GraphContextMenu;
