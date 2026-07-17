/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BODY_JSON_PERSISTENCE_ROLE,
  CANONICAL_DOCUMENT_CONTRACT,
  CANONICAL_DOCUMENT_EXTENSION,
  CANONICAL_DOCUMENT_FORMAT,
  ODESSAY_MARKDOWN_PROFILE_ID,
} from "@/lib/editor/document-profile";
import {
  parseDocumentFileToSnapshot,
  parseMarkdownToSnapshot,
  serializeCanonicalFrontmatter,
  serializeDocumentFile,
  serializeDocumentToMarkdown,
  serializeDocumentToSnapshot,
} from "@/lib/editor/document-serialization";
import { buildWritingMarkdown } from "@/lib/export/writing-export";
import { ANNOTATION_TYPES } from "@/lib/editor/footnote-node";

const collectHighlightTypes = (node: unknown, result: Array<string | null> = []) => {
  if (!node || typeof node !== "object") return result;

  const current = node as {
    marks?: Array<{ type?: string; attrs?: { annotationType?: string | null } }>;
    content?: unknown[];
  };
  for (const mark of current.marks ?? []) {
    if (mark.type === "highlight") {
      result.push(mark.attrs?.annotationType ?? null);
    }
  }
  for (const child of current.content ?? []) {
    collectHighlightTypes(child, result);
  }

  return result;
};

describe("document profile", () => {
  it("declares markdown as the canonical document contract", () => {
    expect(CANONICAL_DOCUMENT_FORMAT).toBe("markdown");
    expect(CANONICAL_DOCUMENT_EXTENSION).toBe(".md");
    expect(ODESSAY_MARKDOWN_PROFILE_ID).toBe("odessay-markdown-v1");
    expect(BODY_JSON_PERSISTENCE_ROLE).toBe("transitional");
    expect(CANONICAL_DOCUMENT_CONTRACT.bodyJsonRole).toBe("transitional");
  });
});

describe("document serialization", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
    });
  });

  it("serializes rich body_json through the canonical markdown route", () => {
    const markdown = serializeDocumentToMarkdown({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Alpha " },
            { type: "text", text: "Beta", marks: [{ type: "highlight" }] },
            { type: "text", text: " " },
            {
              type: "annotationReference",
              attrs: {
                id: "ann-1",
                type: "footnote",
                index: 1,
                text: "Footnote body",
              },
            },
          ],
        },
      ],
    });

    expect(markdown).toContain("# Title");
    expect(markdown).toContain("Alpha ==Beta==");
    expect(markdown).toContain("[^1|ann-1: Footnote body]");
  });

  it("preserves every annotation highlight type across structural markdown round-trips", () => {
    const source = `# ==Heading AI== [@1|ann-ai: Note with ] bracket]

> ==Quoted personal==[@p1|ann-personal: Personal note]

- ==Listed highlight== [@h1|ann-highlight: Saved passage]

==Paragraph footnote== [^1|ann-footnote: Reference on
the next line]`;

    const parsed = parseMarkdownToSnapshot(source);
    const markdown = serializeDocumentToMarkdown(parsed.bodyJson);
    const reparsed = parseMarkdownToSnapshot(markdown);

    expect(collectHighlightTypes(parsed.bodyJson)).toEqual([
      "ai",
      "personal",
      "highlight",
      "footnote",
    ]);
    expect(collectHighlightTypes(reparsed.bodyJson), markdown).toEqual([
      "ai",
      "personal",
      "highlight",
      "footnote",
    ]);
    expect(markdown).toContain("[@1|ann-ai: Note with ] bracket]");
    expect(markdown).toContain("[^1|ann-footnote: Reference on\nthe next line]");
  });

  it("normalizes legacy collaborative markers to personal annotations", () => {
    const parsed = parseMarkdownToSnapshot("==Legacy span==[@c1|ann-c: Legacy note]");
    const markdown = serializeDocumentToMarkdown(parsed.bodyJson);

    expect(collectHighlightTypes(parsed.bodyJson)).toEqual(["personal"]);
    expect(markdown).toBe("==Legacy span==[@p1|ann-c: Legacy note]");
  });

  it("separates consecutive block images when serializing canonical markdown", () => {
    const markdown = serializeDocumentToMarkdown({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Imagenes" }],
        },
        {
          type: "image",
          attrs: { src: "/api/writing-assets/asset-1", alt: "" },
        },
        {
          type: "image",
          attrs: { src: "/api/writing-assets/asset-2", alt: "" },
        },
        {
          type: "image",
          attrs: { src: "/api/writing-assets/asset-3", alt: "Example image" },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Tail paragraph" }],
        },
      ],
    });

    expect(markdown).toBe(`## Imagenes

![](/api/writing-assets/asset-1)

![](/api/writing-assets/asset-2)

![Example image](/api/writing-assets/asset-3)

Tail paragraph`);

    const parsed = parseMarkdownToSnapshot(markdown);
    expect(parsed.bodyJson.content).toMatchObject([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Imagenes" }],
      },
      {
        type: "image",
        attrs: { src: "/api/writing-assets/asset-1", alt: "" },
      },
      {
        type: "image",
        attrs: { src: "/api/writing-assets/asset-2", alt: "" },
      },
      {
        type: "image",
        attrs: { src: "/api/writing-assets/asset-3", alt: "Example image" },
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Tail paragraph" }],
      },
    ]);
  });

  it("creates a stable snapshot for empty inputs", () => {
    const snapshot = serializeDocumentToSnapshot(null);

    expect(snapshot.bodyJson).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(snapshot.bodyText).toBe("");
    expect(snapshot.markdown).toBe("");
  });

  it("keeps export markdown equivalent to the rich serializer on the supported subset", () => {
    const bodyJson: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Alpha " },
            { type: "text", text: "Beta", marks: [{ type: "bold" }] },
            { type: "text", text: " " },
            {
              type: "annotationReference",
              attrs: {
                id: "ann-1",
                type: "footnote",
                index: 1,
                text: "Footnote body",
              },
            },
          ],
        },
      ],
    };

    expect(buildWritingMarkdown(bodyJson)).toBe(
      "# Title\n\nAlpha **Beta** [^1]\n\n[^1]: Footnote body",
    );
    expect(serializeDocumentToMarkdown(bodyJson)).toBe(
      "# Title\n\nAlpha **Beta** [^1|ann-1: Footnote body]",
    );
  });

  it("serializes canonical front-matter with stable field ordering", () => {
    expect(
      serializeCanonicalFrontmatter({
        id: "writing-123",
        slug: "hello-world",
        status: "draft",
        visibility: "private",
        version: 2,
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T01:00:00.000Z",
      }),
    ).toBe(`---
id: writing-123
slug: hello-world
status: draft
visibility: private
version: 2
created_at: '2026-06-03T00:00:00.000Z'
updated_at: '2026-06-03T01:00:00.000Z'
---`);
  });

  it("serializes document files as markdown content only", () => {
    const source = serializeDocumentFile({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Canonical body" }],
        },
      ],
    });

    expect(source).toBe("Canonical body");
    expect(source).not.toContain("---");
    expect(source).not.toContain("id: writing-123");
  });

  it("treats legacy Odessay-shaped front-matter as document content", () => {
    const source = `---
id: writing-123
slug: canonical-body
status: draft
visibility: private
version: 4
created_at: '2026-06-03T00:00:00.000Z'
updated_at: '2026-06-03T02:00:00.000Z'
---

Canonical body`;

    const parsed = parseDocumentFileToSnapshot(source);

    expect(parsed.metadata).toBeNull();
    expect(parsed.snapshot.bodyJson.content?.[0]).toMatchObject({
      type: "frontmatter",
      attrs: { raw: source.slice(4, source.indexOf("\n---")) },
    });
    expect(parsed.snapshot.markdown).toBe(source);
    expect(parsed.snapshot.bodyText).toContain("id: writing-123");
    expect(parsed.snapshot.bodyText).toContain("Canonical body");
  });

  it("preserves legacy Odessay-shaped front-matter in markdown snapshots", () => {
    const snapshot = parseMarkdownToSnapshot(`---
id: writing-123
slug: hello-world
status: draft
visibility: private
version: 2
created_at: '2026-06-03T00:00:00.000Z'
updated_at: '2026-06-03T01:00:00.000Z'
---

# Hello world`);

    expect(snapshot.markdown).toContain("id: writing-123");
    expect(snapshot.bodyText).toContain("id: writing-123");
    expect(snapshot.bodyText).toContain("Hello world");
  });

  it("keeps non-Odessay front-matter as document content", () => {
    const source = `---
name: skill-example
description: Keep this YAML untouched
---

# Skill Body`;

    const parsed = parseDocumentFileToSnapshot(source);

    expect(parsed.metadata).toBeNull();
    expect(parsed.markdown).toContain("name: skill-example");
    expect(parsed.markdown).toContain("# Skill Body");
    expect(parsed.snapshot.bodyJson.content?.[0]).toMatchObject({
      type: "frontmatter",
      attrs: {
        raw: "name: skill-example\ndescription: Keep this YAML untouched",
      },
    });
    expect(parsed.snapshot.bodyText).toContain("name: skill-example");
    expect(parsed.snapshot.bodyText).toContain("Skill Body");
    expect(parsed.snapshot.markdown).toBe(source);
  });
});

describe("annotation presentation contract", () => {
  const globalsCss = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  const notesPanel = readFileSync(
    resolve(process.cwd(), "components/editor/panels/notes-panel.tsx"),
    "utf8",
  );

  it("styles every supported annotation type in editor and reading wrappers", () => {
    for (const type of ANNOTATION_TYPES) {
      expect(globalsCss).toContain(
        `.odessay-editor-content mark[data-annotation-type="${type}"]`,
      );
      expect(globalsCss).toContain(`.prose-odessay mark[data-annotation-type="${type}"]`);
    }
  });

  it("defines annotation hex colors once and makes Notes consume CSS tokens", () => {
    for (const color of ["#5B5BD6", "#C07B2A", "#E8A020", "#999990"]) {
      expect(globalsCss.match(new RegExp(color, "g"))).toHaveLength(1);
      expect(notesPanel).not.toContain(color);
    }

    expect(notesPanel).toContain("ANNOTATION_TYPE_COLOR");
    expect(globalsCss).toMatch(/\.annotation-ref-icon\s*\{[^}]*color:\s*inherit;/s);
  });
});
