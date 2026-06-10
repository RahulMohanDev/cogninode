// src/components/graph/flowTheme.ts
// Shared color plumbing for React Flow surfaces (chat TreeMap + concept
// editor). The MiniMap paints into SVG presentation attributes where
// var()/color-mix() are invalid, so design tokens get resolved to concrete
// values here — re-read per theme so dark-mode overrides apply.

import { useMemo } from "react";
import type { ConceptColor } from "../../lib/db";

export function readToken(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export interface FlowTheme {
  accents: Record<ConceptColor, string>;
  /** Depth scale for chat trees: [root, L1, L2, L3+]. */
  depths:  string[];
  mask:    string;
  bg:      string;
  stroke:  string;
}

export function useFlowTheme(themeKey: string): FlowTheme {
  return useMemo(() => {
    const coral  = readToken("--coral",  "#ff5e3a");
    const teal   = readToken("--teal",   "#0e8a7b");
    const lilac  = readToken("--lilac",  "#7c5cff");
    const butter = readToken("--butter", "#ffd166");
    return {
      accents: { coral, teal, lilac, butter },
      depths:  [coral, teal, lilac, butter],
      mask:    withAlpha(readToken("--bg", "#161413"), 0.72),
      bg:      readToken("--bg-2", "#efe7d6"),
      stroke:  readToken("--line", "#d9cfba"),
    };
    // Tokens change exactly when the theme attribute does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);
}

/** Shared MiniMap chrome (rounded, bordered, themed). */
export function miniMapStyle(theme: FlowTheme): React.CSSProperties {
  return {
    backgroundColor: theme.bg,
    borderRadius: 12,
    border: `1px solid ${theme.stroke}`,
    overflow: "hidden",
  };
}