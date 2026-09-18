import { describe, expect, it } from "vitest";
import { renderPlainTextHtml } from "@/lib/reading/render-body-html-core";
import { buildWritingExportDocument, buildWritingMarkdown } from "@/lib/export/writing-export";

describe("mermaid reading and export fallbacks (ODE-533)", () => {
  it("renders a content-preserving figure for mermaid fences in plain-text reading", () => {
    const html = renderPlainTextHtml("```mermaid\ngraph TD; A-->B\n```");
    expect(html).toContain('data-language="mermaid"');
    expect(html).toContain("graph TD; A--&gt;B");
    expect(html).toContain("Diagram source (mermaid)");
    expect(html).toContain("odessay-mermaid-fallback");
  });

  it("keeps ordinary fences unchanged", () => {
    const html = renderPlainTextHtml("```js\nconst a = 1\n```");
    expect(html).not.toContain("odessay-mermaid-fallback");
    expect(html).toContain("const a = 1");
  });

  it("round-trips mermaid fences with language through export markdown", () => {
    const markdown = buildWritingMarkdown({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: "graph TD; A-->B" }],
        },
      ],
    });
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("graph TD; A-->B");
  });

  it("preserves mermaid source and caption in the export document", () => {
    const document = buildWritingExportDocument({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: "graph TD; A-->B" }],
        },
      ],
    });
    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0]).toMatchObject({
      type: "codeBlock",
      language: "mermaid",
    });
  });
});
