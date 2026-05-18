// Shared markdown renderer used by completed messages AND the live streaming
// tail. Built on streamdown, which is a drop-in for react-markdown that
// gracefully handles partial syntax during a stream (unclosed code fences,
// unclosed bold/italic, etc) so the rendering doesn't "snap" when the stream
// completes.
//
// Anchors are forced to open in a new tab with a hardened rel. Raw HTML in
// markdown is stripped — we don't enable rehype-raw — so untrusted assistant
// output can't inject script tags.

import { Streamdown, type Components } from "streamdown";

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

export function MarkdownBody({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="md">
      <Streamdown components={components}>
        {text}
      </Streamdown>
    </div>
  );
}

export default MarkdownBody;
