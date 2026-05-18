// src/components/Glyph.tsx
// Cogninode logo glyph — TS port of design/glyph.jsx
import type { CSSProperties } from "react";

interface GlyphProps {
  size?:      number;
  color?:     string;
  accent?:    string;
  className?: string;
  style?:     CSSProperties;
}

export function Glyph({
  size      = 22,
  color     = "currentColor",
  accent    = "var(--coral)",
  className,
  style,
}: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      style={style}
    >
      <circle cx="16" cy="6"  r="3.5" fill={color} />
      <circle cx="6"  cy="20" r="3"   fill={color} />
      <circle cx="16" cy="20" r="3"   fill={accent} />
      <circle cx="26" cy="20" r="3"   fill={color} />
      <circle cx="11" cy="28" r="2.2" fill={color} />
      <path
        d="M16 10 L6 17 M16 10 L16 17 M16 10 L26 17 M6 23 L11 26.2"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default Glyph;
