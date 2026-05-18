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
  type MouseEvent as ReactMouseEvent,
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

  if (!editor) {
    return <div className="rte-shell rte-loading">…</div>;
  }

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
        <button
          type="button"
          title="Insert / toggle link"
          className={`rte-btn${editor.isActive("link") ? " active" : ""}`}
          onClick={() => {
            // No window.prompt: if a link mark is active, strip it; otherwise
            // wrap the selection in a placeholder URL that the user can edit
            // inline. (Pasting a URL onto selected text autolinks via
            // tiptap-markdown's linkify.)
            if (editor.isActive("link")) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            if (editor.state.selection.empty) return;
            const existing = (editor.getAttributes("link") as { href?: string }).href;
            editor.chain().focus().setLink({ href: existing || "https://" }).run();
          }}
        >
          🔗
        </button>
        <span className="rte-spacer" />
        <span className="rte-hint">⌘↵ save · esc cancel</span>
      </div>
      <EditorContent editor={editor} onBlur={handleBlur} />
    </div>
  );
}

export default RichEditor;
