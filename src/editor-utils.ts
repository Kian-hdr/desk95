import type { JSONContent } from "@tiptap/core";

const nodes = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "image",
]);
const marks = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
]);

export function safeUrl(value: unknown, image = false): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return false;
  if (/^\/__attachment\/[a-zA-Z0-9_-]+$/.test(value)) return true;
  if (/^#\/(page|attachment)\/[a-zA-Z0-9_-]+$/.test(value)) return !image;
  try {
    return (
      image
        ? ["http:", "https:", "blob:"]
        : ["http:", "https:", "mailto:", "blob:"]
    ).includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const blocks = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "image",
]);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const boundedNumber = (value: unknown, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(1, Math.floor(value)))
    : 1;
const attachmentId = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value) ? value : null;

/** Restrict imported rich text to known nodes, valid child shapes and safe attributes. */
export function sanitizeContent(input: unknown): JSONContent {
  let count = 0;
  function visit(raw: unknown, depth = 0): JSONContent | null {
    if (++count > 100000 || depth > 50)
      throw new Error("Document exceeds the supported size or nesting depth.");
    const n = record(raw);
    if (typeof n.type !== "string" || !nodes.has(n.type)) return null;
    const out: JSONContent = { type: n.type };
    if (n.type === "text") {
      if (typeof n.text !== "string" || !n.text) return null;
      out.text = n.text;
    }
    let children = Array.isArray(n.content)
      ? n.content
          .map((x) => visit(x, depth + 1))
          .filter((x): x is JSONContent => !!x)
      : [];
    const allowed =
      n.type === "doc" ||
      n.type === "blockquote" ||
      n.type === "listItem" ||
      n.type === "taskItem" ||
      n.type === "tableCell" ||
      n.type === "tableHeader"
        ? blocks
        : n.type === "paragraph" || n.type === "heading"
          ? new Set(["text", "hardBreak"])
          : n.type === "codeBlock"
            ? new Set(["text"])
            : n.type === "bulletList" || n.type === "orderedList"
              ? new Set(["listItem"])
              : n.type === "taskList"
                ? new Set(["taskItem"])
                : n.type === "table"
                  ? new Set(["tableRow"])
                  : n.type === "tableRow"
                    ? new Set(["tableCell", "tableHeader"])
                    : new Set<string>();
    children = children.filter((child) => allowed.has(child.type!));
    if (
      ["bulletList", "orderedList", "taskList", "table", "tableRow"].includes(
        n.type,
      ) &&
      !children.length
    )
      return null;
    if (
      [
        "doc",
        "blockquote",
        "listItem",
        "taskItem",
        "tableCell",
        "tableHeader",
      ].includes(n.type) &&
      !children.length
    )
      children = [{ type: "paragraph" }];
    if (
      ["listItem", "taskItem"].includes(n.type) &&
      children[0]?.type !== "paragraph"
    )
      children.unshift({ type: "paragraph" });
    if (children.length) out.content = children;
    const a = record(n.attrs);
    if (n.type === "heading") out.attrs = { level: boundedNumber(a.level, 6) };
    if (n.type === "orderedList")
      out.attrs = { start: boundedNumber(a.start, 1000000) };
    if (n.type === "taskItem") out.attrs = { checked: a.checked === true };
    if (n.type === "codeBlock")
      out.attrs = {
        language:
          typeof a.language === "string" ? a.language.slice(0, 100) : null,
      };
    if (["tableCell", "tableHeader"].includes(n.type))
      out.attrs = {
        colspan: boundedNumber(a.colspan, 20),
        rowspan: boundedNumber(a.rowspan, 100),
      };
    if (n.type === "image") {
      if (!safeUrl(a.src, true)) return null;
      out.attrs = {
        src: a.src,
        alt: typeof a.alt === "string" ? a.alt : "",
        title: typeof a.title === "string" ? a.title : null,
        attachmentId: attachmentId(a.attachmentId),
      };
    }
    if (n.type === "text" && Array.isArray(n.marks)) {
      const seen = new Set<string>();
      out.marks = n.marks.slice(0, 32).flatMap((rawMark) => {
        const m = record(rawMark);
        if (
          typeof m.type !== "string" ||
          !marks.has(m.type) ||
          seen.has(m.type)
        )
          return [];
        seen.add(m.type);
        if (m.type !== "link") return [{ type: m.type }];
        const attrs = record(m.attrs);
        if (!safeUrl(attrs.href)) return [];
        return [
          {
            type: "link",
            attrs: {
              href: attrs.href,
              target: attrs.href.startsWith("#") ? null : "_blank",
              rel: "noopener noreferrer",
              attachmentId: attachmentId(attrs.attachmentId),
            },
          },
        ];
      });
      if (!out.marks.length) delete out.marks;
    }
    return out;
  }
  const result = visit(input);
  return result?.type === "doc"
    ? result
    : { type: "doc", content: [{ type: "paragraph" }] };
}

export function contentToText(content: JSONContent): string {
  if (content.type === "text") return content.text || "";
  return (content.content || [])
    .map(contentToText)
    .join(
      ["doc", "bulletList", "orderedList", "taskList"].includes(
        content.type || "",
      )
        ? "\n"
        : "",
    );
}

export function contentToMarkdown(node: JSONContent, depth = 0): string {
  const children = () =>
    (node.content || []).map((n) => contentToMarkdown(n, depth + 1)).join("");
  switch (node.type) {
    case "text": {
      let text = (node.text || "").replace(/([\\`*_[\]])/g, "\\$1");
      for (const mark of node.marks || []) {
        if (mark.type === "bold") text = `**${text}**`;
        if (mark.type === "italic") text = `*${text}*`;
        if (mark.type === "strike") text = `~~${text}~~`;
        if (mark.type === "code")
          text = "`" + (node.text || "").replace(/`/g, "\\`") + "`";
        if (mark.type === "link" && safeUrl(mark.attrs?.href || ""))
          text = `[${text}](${String(mark.attrs?.href).replace(/\)/g, "%29")})`;
      }
      return text;
    }
    case "doc":
      return children().trim() + "\n";
    case "paragraph":
      return children() + "\n\n";
    case "heading":
      return "#".repeat(node.attrs?.level || 1) + " " + children() + "\n\n";
    case "hardBreak":
      return "  \n";
    case "horizontalRule":
      return "---\n\n";
    case "codeBlock":
      return (
        "```" +
        (node.attrs?.language || "") +
        "\n" +
        contentToText(node) +
        "\n```\n\n"
      );
    case "blockquote":
      return (
        children()
          .trim()
          .split("\n")
          .map((l) => "> " + l)
          .join("\n") + "\n\n"
      );
    case "bulletList":
    case "taskList":
      return (
        (node.content || [])
          .map((n) => contentToMarkdown(n, depth + 1))
          .join("") + "\n"
      );
    case "orderedList":
      return (
        (node.content || [])
          .map(
            (n, i) =>
              `${i + (node.attrs?.start || 1)}. ${contentToMarkdown(
                n,
                depth + 1,
              )
                .replace(/^- /, "")
                .trim()}\n`,
          )
          .join("") + "\n"
      );
    case "listItem":
      return "- " + children().trim().replace(/\n\n/g, "\n  ") + "\n";
    case "taskItem":
      return (
        `- [${node.attrs?.checked ? "x" : " "}] ` + children().trim() + "\n"
      );
    case "image":
      return `![${node.attrs?.alt || ""}](${node.attrs?.src || ""})\n\n`;
    case "table":
      return (
        (node.content || [])
          .map(
            (row, i) =>
              contentToMarkdown(row) +
              (i === 0
                ? "| " +
                  (row.content || []).map(() => "---").join(" | ") +
                  " |\n"
                : ""),
          )
          .join("") + "\n"
      );
    case "tableRow":
      return (
        "| " +
        (node.content || [])
          .map((cell) =>
            contentToMarkdown(cell)
              .trim()
              .replace(/\|/g, "\\|")
              .replace(/\n/g, "<br>"),
          )
          .join(" | ") +
        " |\n"
      );
    default:
      return children();
  }
}

export const toMarkdown = contentToMarkdown;
