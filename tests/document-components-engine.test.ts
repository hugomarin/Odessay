import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PROJECTION_SURFACES,
  DocumentComponentSpecRegistry,
  canonicalizeControlledMarkdown,
  parseControlledComponentAt,
  parseControlledMarkdown,
  serializeControlledDocument,
  validateDocumentComponentCoverage,
} from "@/lib/document-components";
import {
  parseMarkdownToDocumentIr,
  serializeDocumentIrToMarkdown,
} from "@/lib/editor/document-serialization";

const fixtures = join(process.cwd(), "tests/fixtures/document-components");
const fixture = (path: string) => readFileSync(join(fixtures, path), "utf8");

describe("ODE-529 controlled document engine", () => {
  it("offers static O(1) registry lookup with canonical attribute order", () => {
    expect(DocumentComponentSpecRegistry.get("Card")?.attributes.map(({ name }) => name)).toEqual([
      "title",
      "icon",
      "href",
    ]);
    expect(DocumentComponentSpecRegistry.get("Entity")?.attributes.map(({ name }) => name)).toEqual([
      "id",
      "type",
      "ref",
    ]);
    expect(DocumentComponentSpecRegistry.get("Highlight")?.attributes.map(({ name }) => name)).toEqual([
      "color",
    ]);
    expect(DocumentComponentSpecRegistry.get("Unknown")).toBeUndefined();
    expect(DocumentComponentSpecRegistry.values()).toHaveLength(16);
  });

  it("treats fences as opaque even when they contain registered tags", () => {
    const parsed = parseControlledMarkdown(fixture("valid/mixed.md"));
    const fence = parsed.document.children.find((node) => node.type === "code-block");
    expect(fence).toMatchObject({ type: "code-block", language: "tsx" });
    expect(fence && "raw" in fence ? fence.raw : "").toContain('<Card title="This is literal">');
  });

  it("canonicalizes known attributes once and is byte-idempotent", () => {
    const source = '<Card href="https://example.com/?a=1&amp;b=2" title="A &lt; B" icon="book">\nBody\n</Card>';
    const canonical = canonicalizeControlledMarkdown(source);
    expect(canonical).toBe('<Card title="A &lt; B" icon="book" href="https://example.com/?a=1&amp;b=2">\nBody\n</Card>');
    expect(canonicalizeControlledMarkdown(canonical)).toBe(canonical);
  });

  it("keeps block-looking tags literal when they do not occupy their own lines", () => {
    const source = 'Before <Tip title="x">literal</Tip> after';
    const parsed = parseControlledMarkdown(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.children).toEqual([
      { type: "markdown", raw: source, start: 0, end: source.length },
    ]);
    expect(canonicalizeControlledMarkdown(source)).toBe(source);
  });

  it("parses one controlled block from its source offset without copying the suffix", () => {
    const source = 'Prelude\n\n<Tip title="At offset">\nBody\n</Tip>\n\nEpilogue';
    const start = source.indexOf("<Tip");
    const component = parseControlledComponentAt(source, start);

    expect(component).toMatchObject({ kind: "Tip", start });
    expect(component?.end).toBe(source.indexOf("</Tip>") + "</Tip>".length);
    expect(parseControlledComponentAt(source, start + 1)).toBeNull();
  });

  it.each(["Annotation", "Highlight", "Entity", "ProtectedText"])(
    "preserves an empty %s as invalid opaque source",
    (kind) => {
      const attributes = kind === "Annotation"
        ? 'id="a" type="footnote" comment=""'
        : kind === "Entity"
          ? 'id="e" type="person"'
          : kind === "ProtectedText"
            ? 'id="x"'
            : "";
      const source = `<${kind}${attributes ? ` ${attributes}` : ""}></${kind}>`;
      const parsed = parseControlledMarkdown(source);

      expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
        code: "invalid-content",
        kind,
      }));
      expect(serializeControlledDocument(parsed.document)).toBe(source);
    },
  );

  it.each([
    ["Highlight", '<Highlight id="h1">text</Highlight>'],
    ["Highlight", '<Highlight color="amber" id="h1">text</Highlight>'],
    ["Entity", '<Entity id="e1">text</Entity>'],
    ["Entity", '<Entity type="person">text</Entity>'],
    ["Entity", '<Entity id="e1" type="person" ref="ref" extra="x">text</Entity>'],
  ])("preserves an invalid %s as opaque source", (kind, source) => {
    const parsed = parseControlledMarkdown(source);

    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid-attributes",
      kind,
    }));
    expect(serializeControlledDocument(parsed.document)).toBe(source);
  });

  it("canonicalizes Entity and Highlight inline semantics", () => {
    const source = 'See <Highlight color="amber">this</Highlight> about <Entity id="ent-123" ref="https://example.com" type="company">Aplyca</Entity>.';
    const canonical = canonicalizeControlledMarkdown(source);
    expect(canonical).toBe(
      'See <Highlight color="amber">this</Highlight> about <Entity id="ent-123" type="company" ref="https://example.com">Aplyca</Entity>.',
    );
    expect(canonicalizeControlledMarkdown(canonical)).toBe(canonical);
  });

  it("round-trips a Highlight without attributes with the amber default", () => {
    const source = "<Highlight>text</Highlight>";
    const canonical = canonicalizeControlledMarkdown(source);
    expect(canonical).toBe(source);
  });

  it("accepts only explicit safe schemes or document-relative Card links", () => {
    const href = DocumentComponentSpecRegistry.get("Card")?.attributes.find(({ name }) => name === "href");

    expect(href?.validate?.("https://example.com")).toBe(true);
    expect(href?.validate?.("mailto:reader@example.com")).toBe(true);
    expect(href?.validate?.("../chapter/two")).toBe(true);
    expect(href?.validate?.("chapter/two")).toBe(true);
    expect(href?.validate?.("#notes")).toBe(true);
    expect(href?.validate?.("//evil.example")).toBe(false);
    expect(href?.validate?.(String.raw`\evil.example`)).toBe(false);
    expect(href?.validate?.(String.raw`chapter\evil.example`)).toBe(false);
    expect(href?.validate?.(" javascript:alert(1)")).toBe(false);
    expect(href?.validate?.("data:text/html,bad")).toBe(false);
    expect(href?.validate?.("file:///tmp/private")).toBe(false);
  });

  it.each([
    ["invalid/unbalanced.md", "unbalanced-component"],
    ["invalid/unknown-tag.md", "unknown-component"],
    ["invalid/attributes.md", "invalid-attributes"],
  ])("preserves %s opaque source byte-for-byte", (path, code) => {
    const source = fixture(path);
    const parsed = parseControlledMarkdown(source);
    expect(parsed.diagnostics.some((entry) => entry.code === code)).toBe(true);
    expect(serializeControlledDocument(parsed.document)).toBe(source);
  });

  it("reads legacy annotations but only writes canonical Annotation", () => {
    const source = "This ==older annotation==[@n: Keep this comment] remains readable.";
    const canonical = canonicalizeControlledMarkdown(source);
    expect(canonical).toMatch(/This <Annotation id="legacy-[a-f0-9]{8}" type="footnote" comment="Keep this comment">older annotation<\/Annotation> remains readable\./);
    expect(canonical).not.toContain("[@n:");
  });

  it("validates container nesting and preserves invalid groups as opaque", () => {
    const valid = parseControlledMarkdown(fixture("valid/nesting.md"));
    expect(valid.diagnostics).toEqual([]);
    const invalid = "<Tabs>\n<Card title=\"Wrong child\">\nBody\n</Card>\n</Tabs>";
    const parsed = parseControlledMarkdown(invalid);
    expect(parsed.diagnostics.some(({ code }) => code === "invalid-nesting")).toBe(true);
    expect(serializeControlledDocument(parsed.document)).toBe(invalid);
  });

  it.each([10, 100, 1000])("round-trips the %i-component fixture", (count) => {
    const source = fixture(`scale/${count}.md`);
    const parsed = parseControlledMarkdown(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(serializeControlledDocument(parsed.document)).toBe(source);
  });

  it("exposes one adapter at the existing serialization boundary", () => {
    const parsed = parseMarkdownToDocumentIr(fixture("valid/mixed.md"));
    expect(serializeDocumentIrToMarkdown(parsed)).toBe(
      canonicalizeControlledMarkdown(fixture("valid/mixed.md")),
    );
  });

  it("fails coverage for any missing kind or projection", () => {
    const full = Object.fromEntries(
      DocumentComponentSpecRegistry.values().map(({ kind }) => [kind, DOCUMENT_PROJECTION_SURFACES]),
    );
    expect(validateDocumentComponentCoverage(full)).toEqual([]);
    expect(validateDocumentComponentCoverage({ Card: ["source"] })).toContainEqual({
      kind: "Card",
      missing: DOCUMENT_PROJECTION_SURFACES.filter((surface) => surface !== "source"),
    });
  });
});
