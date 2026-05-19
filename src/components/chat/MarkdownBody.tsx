// Shared markdown renderer used by completed messages AND the live streaming
// tail. Built on streamdown, which is a drop-in for react-markdown that
// gracefully handles partial syntax during a stream (unclosed code fences,
// unclosed bold/italic, etc) so the rendering doesn't "snap" when the stream
// completes.
//
// Anchors are forced to open in a new tab with a hardened rel. Raw HTML in
// markdown is stripped — we don't enable rehype-raw — so untrusted assistant
// output can't inject script tags.
//
// Fenced code blocks use streamdown's built-in <CodeBlock> family. Streamdown
// emits a stable markup tree of `data-streamdown="code-block" / -header /
// -actions / -copy-button / -body` elements that we style via app.css into a
// GitHub-style card (header bar on top, language label left, copy button
// right, shiki-highlighted body below). Theme switching is zero-cost: shiki
// inlines `--sdm-c` (light) and `--shiki-dark` (dark) CSS variables on each
// token span, and our CSS picks the right one based on `html[data-theme]`.
//
// We pass `controls.code.download = false` to suppress streamdown's optional
// download button (we only want copy), and disable table/mermaid controls
// since the rest of the app doesn't expose them.

import { Streamdown, type Components, type ControlsConfig } from "streamdown";

const components: Components = {
  a: ({ node: _node, href, children, ...rest }) => (
    <a
      {...rest}
      href={href ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};

// Suppress streamdown's table/mermaid action overlays and the code-block
// download button — we only want the copy button on code blocks.
const controls: ControlsConfig = {
  code:    { copy: true, download: false },
  table:   false,
  mermaid: false,
};

export function MarkdownBody({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="md">
      <Streamdown
        components={components}
        controls={controls}
        lineNumbers={false}
      >
        {text}
      </Streamdown>
    </div>
  );
}

export default MarkdownBody;
