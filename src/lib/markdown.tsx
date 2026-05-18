// src/lib/markdown.tsx
// Tiptap-based rich-text editor for editing chat messages. This module is
// pulled in by Message.tsx via a dynamic `import()` so the heavy ProseMirror
// / Tiptap / markdown-it dependencies code-split into their own async chunk
// and don't bloat the initial app bundle. The default export is the
// `RichEditor` component (so `React.lazy(() => import(...))` works directly).
//
// Sanitization: `tiptap-markdown` is configured with `html: false`, which
// instructs the underlying markdown-it parser to strip raw HTML when
// converting markdown to ProseMirror nodes. Combined with the read-path
// react-markdown (also no raw HTML) in Message.tsx, untrusted assistant
// output can't smuggle live `<script>` tags through either pipeline.

import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useEditor, EditorContent }   from "@tiptap/react";
import StarterKit                     from "@tiptap/starter-kit";
import { Markdown }                   from "tiptap-markdown";
import type { Editor }                from "@tiptap/core";

// ── Tiptap editor ─────────────────────────────────────────────────

export interface RichEditorProps {
  initial:  string;
  onSave:   (markdown: string) => void;
  onCancel: () => void;
  /** Bubble class so the host can theme inverted (user) vs. light (assistant). */
  variant?: "default" | "inverted";
}

interface ToolbarButton {
  key:    string;
  label:  string;
  title:  string;
  isActive(ed: Editor): boolean;
  apply(ed: Editor): void;
}

/** Pull the markdown string out of the editor's storage bag.
 *  Tiptap's `storage` type is `Record<string, any>` at runtime but typed as
 *  an empty `Storage` interface, so we cast through `unknown`. */
function getMarkdown(ed: Editor): string {
  const bag = ed.storage as unknown as Record<string, { getMarkdown?: () => string } | undefined>;
  return bag["markdown"]?.getMarkdown?.() ?? "";
}

const TOOLBAR_BUTTONS: ToolbarButton[] = [
  {
    key: "h",
    label: "H",
    title: "Toggle heading (cycles H2 → H3 → paragraph)",
    isActive: (ed) => ed.isActive("heading"),
    apply: (ed) => {
      if (ed.isActive("heading", { level: 2 })) {
        ed.chain().focus().toggleHeading({ level: 3 }).run();
      } else if (ed.isActive("heading", { level: 3 })) {
        ed.chain().focus().setParagraph().run();
      } else {
        ed.chain().focus().toggleHeading({ level: 2 }).run();
      }
    },
  },
  {
    key: "b",
    label: "B",
    title: "Bold (⌘B)",
    isActive: (ed) => ed.isActive("bold"),
    apply:    (ed) => ed.chain().focus().toggleBold().run(),
  },
  {
    key: "i",
    label: "I",
    title: "Italic (⌘I)",
    isActive: (ed) => ed.isActive("italic"),
    apply:    (ed) => ed.chain().focus().toggleItalic().run(),
  },
  {
    key: "code",
    label: "<>",
    title: "Inline code (⌘E)",
    isActive: (ed) => ed.isActive("code"),
    apply:    (ed) => ed.chain().focus().toggleCode().run(),
  },
  {
    key: "ul",
    label: "•",
    title: "Bullet list",
    isActive: (ed) => ed.isActive("bulletList"),
    apply:    (ed) => ed.chain().focus().toggleBulletList().run(),
  },
  {
    key: "ol",
    label: "1.",
    title: "Numbered list",
    isActive: (ed) => ed.isActive("orderedList"),
    apply:    (ed) => ed.chain().focus().toggleOrderedList().run(),
  },
  {
    key: "quote",
    label: "❝",
    title: "Blockquote",
    isActive: (ed) => ed.isActive("blockquote"),
    apply:    (ed) => ed.chain().focus().toggleBlockquote().run(),
  },
];

export function RichEditor({
  initial,
  onSave,
  onCancel,
  variant = "default",
}: RichEditorProps) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // Use the built-in link extension, but make sure clicks during editing
        // don't navigate away mid-edit. Markdown serializer still emits [text](url).
        link: {
          openOnClick: false,
          autolink:    true,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        },
        // Code-block highlighting we explicitly skip (keeps bundle small).
        codeBlock: { HTMLAttributes: { class: "code-block" } },
      }),
      Markdown.configure({
        html:                false, // <-- strip raw HTML on parse
        linkify:             true,
        breaks:              false,
        tightLists:          true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content:           initial,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: `rte-content${variant === "inverted" ? " rte-inverted" : ""}`,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          // Defer so React's state-update doesn't fight Tiptap's keymap.
          queueMicrotask(() => onCancel());
          return true;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          if (editor) {
            const md = getMarkdown(editor);
            queueMicrotask(() => onSave(md));
          }
          return true;
        }
        return false;
      },
    },
  });

  // If the underlying message content changes externally (merge, etc.) while
  // the editor is open, refresh the editor's document.
  useEffect(() => {
    if (!editor) return;
    const current = getMarkdown(editor);
    if (current.trim() === initial.trim()) return;
    editor.commands.setContent(initial);
  }, [initial, editor]);

  const handleBlur = useCallback(() => {
    if (!editor) return;
    onSave(getMarkdown(editor));
  }, [editor, onSave]);

  // Toolbar clicks must not steal focus from the editor (which would trigger
  // an unwanted blur-save before the format command actually applies).
  const preventBlur = (e: ReactMouseEvent): void => { e.preventDefault(); };

  // ── Link popover state ────────────────────────────────────────
  // The popover is rendered inline beneath the toolbar's link button. We keep
  // a wrapper ref so the outside-click listener can let clicks inside the
  // popover (or on the button itself) through without dismissing.
  const [linkOpen, setLinkOpen]       = useState(false);
  const [linkValue, setLinkValue]     = useState("");
  const linkWrapRef  = useRef<HTMLSpanElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);

  const closeLink = useCallback((): void => {
    setLinkOpen(false);
  }, []);

  const openLink = useCallback((): void => {
    if (!editor) return;
    const existing = (editor.getAttributes("link") as { href?: string }).href ?? "";
    setLinkValue(existing);
    setLinkOpen(true);
  }, [editor]);

  // Focus the input once the popover mounts.
  useEffect(() => {
    if (!linkOpen) return;
    // Defer to next frame so the input is attached before focusing.
    const id = requestAnimationFrame(() => {
      const el = linkInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [linkOpen]);

  // Single document-level mousedown listener for outside-click dismissal.
  useEffect(() => {
    if (!linkOpen) return;
    const onDocDown = (ev: MouseEvent): void => {
      const wrap = linkWrapRef.current;
      if (!wrap) return;
      if (ev.target instanceof Node && wrap.contains(ev.target)) return;
      setLinkOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [linkOpen]);

  /** Normalize bare-domain inputs ("foo.com") to "https://foo.com". Mailto
   *  and path-relative hrefs pass through untouched. */
  const normalizeHref = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    if (/^(https?:|mailto:|\/)/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const applyLink = useCallback((): void => {
    if (!editor) return;
    const href = normalizeHref(linkValue);
    if (!href) {
      // Empty input on Apply = unlink, matching common editor convention.
      editor.chain().focus().unsetLink().run();
      closeLink();
      return;
    }
    // setLink({ href }) works for both collapsed-cursor-in-link and ranged
    // selections. When the cursor is inside an existing link mark, Tiptap
    // extends the mark over the full link and updates the href; for a ranged
    // selection it wraps the range in the link mark. For a fully-collapsed
    // selection outside any link, ProseMirror has no range to attach a mark
    // to — fall back to inserting the URL as its own linked label.
    const sel = editor.state.selection;
    const inLink = editor.isActive("link");
    if (sel.empty && !inLink) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      editor.chain().focus().setLink({ href }).run();
    }
    closeLink();
  }, [editor, linkValue, closeLink]);

  const removeLink = useCallback((): void => {
    if (!editor) return;
    editor.chain().focus().unsetLink().run();
    closeLink();
  }, [editor, closeLink]);

  const onLinkInputKeyDown = (ev: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      applyLink();
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeLink();
    }
  };

  if (!editor) {
    return <div className="rte-shell rte-loading">…</div>;
  }

  const currentHrefForOpen = normalizeHref(linkValue);
  const showOpenLink = linkOpen && /^(https?:|mailto:)/i.test(currentHrefForOpen);

  return (
    <div className={`rte-shell${variant === "inverted" ? " rte-shell-inverted" : ""}`}>
      <div className="rte-toolbar" onMouseDown={preventBlur}>
        {TOOLBAR_BUTTONS.map((btn) => (
          <button
            key={btn.key}
            type="button"
            title={btn.title}
            className={`rte-btn${btn.isActive(editor) ? " active" : ""}`}
            onClick={() => btn.apply(editor)}
          >
            {btn.label}
          </button>
        ))}
        <span className="rte-sep" aria-hidden />
        <span ref={linkWrapRef} className="rte-link-wrap">
          <button
            type="button"
            title="Insert / edit link"
            aria-haspopup="dialog"
            aria-expanded={linkOpen}
            className={`rte-btn${editor.isActive("link") || linkOpen ? " active" : ""}`}
            onClick={() => (linkOpen ? closeLink() : openLink())}
          >
            🔗
          </button>
          {linkOpen ? (
            <div
              className="rte-link-popover"
              role="dialog"
              aria-label="Edit link"
              // Clicks inside the popover should not blur the editor (which
              // would commit a save before Apply runs).
              onMouseDown={preventBlur}
            >
              <input
                ref={linkInputRef}
                type="text"
                className="rte-link-input"
                placeholder="Paste URL or type one"
                value={linkValue}
                onChange={(ev) => setLinkValue(ev.target.value)}
                onKeyDown={onLinkInputKeyDown}
                spellCheck={false}
                autoComplete="off"
              />
              <div className="rte-link-actions">
                {showOpenLink ? (
                  <a
                    className="rte-link-open"
                    href={currentHrefForOpen}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={currentHrefForOpen}
                  >
                    Open ↗
                  </a>
                ) : (
                  <span className="rte-link-open rte-link-open-placeholder" aria-hidden>
                    Open ↗
                  </span>
                )}
                <span className="rte-link-spacer" />
                <button
                  type="button"
                  className="rte-link-btn rte-link-btn-ghost"
                  onClick={removeLink}
                  disabled={!editor.isActive("link")}
                >
                  Remove
                </button>
                <button
                  type="button"
                  className="rte-link-btn rte-link-btn-primary"
                  onClick={applyLink}
                >
                  Apply
                </button>
              </div>
            </div>
          ) : null}
        </span>
        <span className="rte-spacer" />
        <span className="rte-hint">⌘↵ save · esc cancel</span>
      </div>
      <EditorContent editor={editor} onBlur={handleBlur} />
    </div>
  );
}

export default RichEditor;
