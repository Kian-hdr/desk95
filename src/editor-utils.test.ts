import { describe, expect, it } from "vitest";
import { sanitizeContent, safeUrl, toMarkdown } from "./editor-utils";

describe("rich text safety boundary", () => {
  it("rejects executable and malformed URLs while retaining supported links", () => {
    for (const value of [
      null,
      undefined,
      42,
      {},
      "javascript:alert(1)",
      "data:text/html,<script>x</script>",
      " javaScript:alert(1)",
      "https://safe.example\n",
      "#/page/../../bad",
    ])
      expect(safeUrl(value)).toBe(false);
    for (const value of [
      "https://example.com/page",
      "mailto:kian@example.com",
      "#/page/abc-123",
      "/__attachment/abc-123",
    ])
      expect(safeUrl(value)).toBe(true);
    expect(safeUrl("#/page/abc", true)).toBe(false);
  });
  it("handles malformed marks and drops event handlers, unknown nodes and unsafe links", () => {
    const doc = sanitizeContent({
      type: "doc",
      content: [
        null,
        { type: "script", attrs: { src: "https://evil.example" } },
        {
          type: "paragraph",
          attrs: { onclick: "alert(1)" },
          content: [
            {
              type: "text",
              text: "Safe text",
              marks: [
                null,
                false,
                "bold",
                {},
                { type: "bold" },
                { type: "bold" },
                { type: "link", attrs: { href: "javascript:alert(1)" } },
              ],
            },
          ],
        },
      ],
    });
    expect(doc).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Safe text", marks: [{ type: "bold" }] },
          ],
        },
      ],
    });
    expect(toMarkdown(doc)).toBe("**Safe text**\n");
  });
  it("normalizes invalid child shapes and bounded numeric attributes", () => {
    const doc = sanitizeContent({
      type: "doc",
      content: [
        { type: "text", text: "Invalid top level" },
        {
          type: "heading",
          attrs: { level: Infinity },
          content: [
            { type: "image", attrs: { src: "https://example.com/img.png" } },
            { type: "text", text: "Heading" },
          ],
        },
        { type: "bulletList", content: [{ type: "paragraph" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 200, rowspan: -4 },
                  content: [],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(doc.content).toHaveLength(2);
    expect(doc.content![0]).toEqual({
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Heading" }],
    });
    expect(doc.content![1].content![0].content![0]).toEqual({
      type: "tableCell",
      attrs: { colspan: 20, rowspan: 1 },
      content: [{ type: "paragraph" }],
    });
  });
  it("preserves canonical attachment identity while discarding unsafe image attributes", () => {
    const doc = sanitizeContent({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "/__attachment/file-1",
            attachmentId: "file-1",
            alt: "Diagram",
            onerror: "alert(1)",
          },
        },
        {
          type: "image",
          attrs: { src: 'data:image/svg+xml,<svg onload="alert(1)"/>' },
        },
      ],
    });
    expect(doc.content).toEqual([
      {
        type: "image",
        attrs: {
          src: "/__attachment/file-1",
          attachmentId: "file-1",
          alt: "Diagram",
          title: null,
        },
      },
    ]);
  });
  it("rejects deeply nested input with an explicit error", () => {
    let doc: unknown = { type: "paragraph" };
    for (let i = 0; i < 60; i++) doc = { type: "blockquote", content: [doc] };
    expect(() => sanitizeContent({ type: "doc", content: [doc] })).toThrow(
      "nesting depth",
    );
  });
});
