import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { safeUrl, sanitizeContent } from "./editor-utils";
import {
  downloadFile,
  isNative,
  nativeMessage,
  SaveCancelledError,
} from "./native";

export interface EditorProps {
  content: JSONContent;
  onChange: (json: JSONContent, text: string) => void;
  editable?: boolean;
  onCreateTask?: (selection: string) => void;
  pages?: { id: string; title: string }[];
  onAttach?: (
    file: File,
  ) => Promise<{ id: string; url: string; name: string; mime: string }>;
  resolveAttachment?: (id: string) => Promise<string | null>;
  onSaveError?: (message: string) => void;
}

export default function Editor(props: EditorProps) {
  const { content, editable: requestedEditable = true, pages = [] } = props;
  const safeContent = useMemo(() => {
    try {
      return { doc: sanitizeContent(content), error: "" };
    } catch (error) {
      return {
        doc: sanitizeContent(null),
        error:
          error instanceof Error
            ? error.message
            : "This document cannot be opened safely.",
      };
    }
  }, [content]);
  const editable = requestedEditable && !safeContent.error;
  const propsRef = useRef(props);
  propsRef.current = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const [slash, setSlash] = useState<{
    from: number;
    to: number;
    query: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, render] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      Link.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            attachmentId: {
              default: null,
              parseHTML: (el) => el.getAttribute("data-attachment-id"),
              renderHTML: (attrs) =>
                attrs.attachmentId
                  ? { "data-attachment-id": attrs.attachmentId }
                  : {},
            },
          };
        },
      }).configure({
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
        isAllowedUri: (url) => safeUrl(url),
        HTMLAttributes: { rel: "noopener noreferrer" },
      }),
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            attachmentId: {
              default: null,
              parseHTML: (el) => el.getAttribute("data-attachment-id"),
              renderHTML: (attrs) =>
                attrs.attachmentId
                  ? { "data-attachment-id": attrs.attachmentId }
                  : {},
            },
          };
        },
        addNodeView() {
          return ({ node }) => {
            const img = document.createElement("img");
            img.alt = String(node.attrs.alt || "");
            img.title = String(node.attrs.title || "");
            if (node.attrs.attachmentId) {
              img.alt = img.alt || "Attached image";
              void propsRef.current
                .resolveAttachment?.(node.attrs.attachmentId)
                .then((url) => {
                  if (url) img.src = url;
                  else img.alt += " (file unavailable)";
                })
                .catch(() => {
                  img.alt += " (file unavailable)";
                });
            } else if (safeUrl(node.attrs.src || "", true))
              img.src = node.attrs.src;
            return { dom: img };
          };
        },
      }).configure({ allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: "Write something, or type / for commands…",
      }),
    ],
    content: safeContent.doc,
    editable,
    editorProps: {
      attributes: {
        class: "document-editor",
        role: "textbox",
        "aria-label": "Document content",
        "aria-multiline": "true",
        spellcheck: "true",
      },
      handleClick(_view, _pos, event) {
        const link = (event.target as HTMLElement).closest("a");
        if (!link) return false;
        const href = link.getAttribute("href") || "";
        const attachmentId = link.dataset.attachmentId;
        if (attachmentId) {
          event.preventDefault();
          void propsRef.current
            .resolveAttachment?.(attachmentId)
            .then(async (url) => {
              if (!url) throw new Error("This attachment is unavailable.");
              if (isNative()) {
                await downloadFile(
                  await (await fetch(url)).blob(),
                  link.textContent || "attachment",
                );
                return;
              }
              const a = document.createElement("a");
              a.href = url;
              a.download = link.textContent || "attachment";
              a.click();
            })
            .catch((error) => {
              if (!(error instanceof SaveCancelledError))
                propsRef.current.onSaveError?.(String(error));
            });
          return true;
        }
        if (href.startsWith("#/page/")) {
          event.preventDefault();
          window.location.hash = href;
          return true;
        }
        if (
          (event.metaKey ||
            event.ctrlKey ||
            propsRef.current.editable === false) &&
          safeUrl(href)
        ) {
          event.preventDefault();
          if (isNative())
            void nativeMessage({ command: "openExternal", url: href }).catch(
              (error) => propsRef.current.onSaveError?.(String(error)),
            );
          else window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        return false;
      },
      handleKeyDown(_view, event) {
        if (event.key === "Escape") {
          setSlash(null);
          return false;
        }
        return false;
      },
    },
    onUpdate({ editor: e }) {
      if (propsRef.current.editable === false) return;
      propsRef.current.onChange(e.getJSON(), e.getText());
      const { $from, from } = e.state.selection;
      const before = $from.parent.textBetween(
        0,
        $from.parentOffset,
        undefined,
        "\ufffc",
      );
      const match = before.match(/(?:^|\s)\/([a-z ]*)$/i);
      setSlash(
        match
          ? { from: from - match[1].length - 1, to: from, query: match[1] }
          : null,
      );
    },
    onSelectionUpdate() {
      render((x) => x + 1);
    },
    onTransaction() {
      render((x) => x + 1);
    },
  });
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);
  useEffect(() => {
    if (safeContent.error) propsRef.current.onSaveError?.(safeContent.error);
  }, [safeContent.error]);
  useEffect(() => {
    if (!editor) return;
    // Schema defaults make the comparison stable, preserving selection on ordinary input.
    const normalized = editor.schema.nodeFromJSON(safeContent.doc).toJSON();
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(normalized))
      editor.commands.setContent(normalized, { emitUpdate: false });
  }, [editor, safeContent.doc]);

  if (!editor) return <div role="status">Opening document…</div>;
  const run = (action: () => unknown) => {
    if (editable) action();
  };
  const addLink = () => {
    const href = window.prompt(
      "Link address (https://…, mailto:…, or #/page/…)",
      editor.getAttributes("link").href || "https://",
    );
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (!safeUrl(href.trim())) {
      props.onSaveError?.("Use an http, https, mailto, or internal page link.");
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: href.trim() })
      .run();
  };
  const attach = async (file?: File) => {
    if (!file || !props.onAttach || !editable) return;
    setBusy(true);
    try {
      const result = await props.onAttach(file);
      if (
        [
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
          "image/avif",
        ].includes(result.mime)
      ) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "image",
            attrs: {
              src: result.url,
              attachmentId: result.id,
              alt: result.name,
            },
          })
          .run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent([
            {
              type: "text",
              text: result.name,
              marks: [
                {
                  type: "link",
                  attrs: { href: result.url, attachmentId: result.id },
                },
              ],
            },
            { type: "text", text: " " },
          ])
          .run();
      }
    } catch (error) {
      props.onSaveError?.(
        error instanceof Error ? error.message : "Could not save attachment.",
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const commands = [
    {
      name: "Heading 1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      name: "Heading 2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      name: "Heading 3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      name: "Paragraph",
      action: () => editor.chain().focus().setParagraph().run(),
    },
    {
      name: "Bullet list",
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: "Numbered list",
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      name: "Checklist",
      action: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      name: "Quote",
      action: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      name: "Code block",
      action: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      name: "Divider",
      action: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      name: "Table",
      action: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
  ];
  const tool = (
    label: string,
    action: () => unknown,
    active = false,
    disabled = false,
  ) => (
    <button
      type="button"
      key={label}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={active ? "editor-tool active" : "editor-tool"}
      disabled={!editable || disabled}
      onClick={() => run(action)}
    >
      {label}
    </button>
  );
  return (
    <div className="rich-editor">
      {safeContent.error && (
        <p role="alert">
          {safeContent.error} The saved original has been preserved.
        </p>
      )}
      <div className="editor-toolbar" role="group" aria-label="Text formatting">
        <select
          aria-label="Text style"
          disabled={!editable}
          value={
            editor.isActive("heading")
              ? `h${editor.getAttributes("heading").level}`
              : editor.isActive("codeBlock")
                ? "code"
                : "paragraph"
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("h"))
              editor
                .chain()
                .focus()
                .setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 })
                .run();
            else if (v === "code")
              editor.chain().focus().toggleCodeBlock().run();
            else editor.chain().focus().setParagraph().run();
          }}
        >
          <option value="paragraph">Normal text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="code">Code block</option>
        </select>
        {tool(
          "Bold",
          () => editor.chain().focus().toggleBold().run(),
          editor.isActive("bold"),
        )}
        {tool(
          "Italic",
          () => editor.chain().focus().toggleItalic().run(),
          editor.isActive("italic"),
        )}
        {tool(
          "Underline",
          () => editor.chain().focus().toggleUnderline().run(),
          editor.isActive("underline"),
        )}
        {tool(
          "Strike",
          () => editor.chain().focus().toggleStrike().run(),
          editor.isActive("strike"),
        )}
        {tool("Link", addLink, editor.isActive("link"))}
        {tool(
          "Bullets",
          () => editor.chain().focus().toggleBulletList().run(),
          editor.isActive("bulletList"),
        )}
        {tool(
          "Numbered",
          () => editor.chain().focus().toggleOrderedList().run(),
          editor.isActive("orderedList"),
        )}
        {tool(
          "Checklist",
          () => editor.chain().focus().toggleTaskList().run(),
          editor.isActive("taskList"),
        )}
        {tool(
          "Quote",
          () => editor.chain().focus().toggleBlockquote().run(),
          editor.isActive("blockquote"),
        )}
        {tool("Divider", () =>
          editor.chain().focus().setHorizontalRule().run(),
        )}
        {tool("Table", () =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run(),
        )}
        {tool(
          "Undo",
          () => editor.chain().focus().undo().run(),
          false,
          !editor.can().undo(),
        )}
        {tool(
          "Redo",
          () => editor.chain().focus().redo().run(),
          false,
          !editor.can().redo(),
        )}
        {props.onAttach &&
          tool(
            busy ? "Attaching…" : "Attach",
            () => fileInput.current?.click(),
            false,
            busy,
          )}
        {props.onCreateTask &&
          tool(
            "Create linked task",
            () => {
              const { from, to } = editor.state.selection;
              const selection = editor.state.doc
                .textBetween(from, to, " ")
                .trim();
              if (selection) props.onCreateTask?.(selection);
            },
            false,
            editor.state.selection.empty,
          )}
        {!!pages.length && (
          <select
            aria-label="Insert page link"
            value=""
            disabled={!editable}
            onChange={(e) => {
              const page = pages.find((p) => p.id === e.target.value);
              if (page)
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "text",
                    text: page.title || "Untitled page",
                    marks: [
                      { type: "link", attrs: { href: `#/page/${page.id}` } },
                    ],
                  })
                  .run();
            }}
          >
            <option value="">Link to page…</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || "Untitled page"}
              </option>
            ))}
          </select>
        )}
        <input
          ref={fileInput}
          type="file"
          hidden
          aria-label="Attach file"
          onChange={(e) => void attach(e.target.files?.[0])}
        />
      </div>
      {editor.isActive("table") && (
        <div className="editor-toolbar" role="group" aria-label="Table actions">
          {tool("Add row", () => editor.chain().focus().addRowAfter().run())}
          {tool("Add column", () =>
            editor.chain().focus().addColumnAfter().run(),
          )}
          {tool("Delete row", () => editor.chain().focus().deleteRow().run())}
          {tool("Delete column", () =>
            editor.chain().focus().deleteColumn().run(),
          )}
          {tool("Delete table", () =>
            editor.chain().focus().deleteTable().run(),
          )}
        </div>
      )}
      <EditorContent editor={editor} />
      {slash && editable && (
        <div className="slash-menu" role="group" aria-label="Insert block">
          <span className="slash-label">Insert block</span>
          {commands
            .filter((c) =>
              c.name.toLowerCase().includes(slash.query.toLowerCase()),
            )
            .map((c) => (
              <button
                type="button"
                key={c.name}
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .deleteRange({ from: slash.from, to: slash.to })
                    .run();
                  c.action();
                  setSlash(null);
                }}
              >
                {c.name}
              </button>
            ))}
          <button type="button" onClick={() => setSlash(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
