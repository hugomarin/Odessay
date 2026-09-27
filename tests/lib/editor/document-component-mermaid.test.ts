/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, type Content } from "@tiptap/core";
import { createEditorExtensions, getEditorMarkdown } from "@/lib/editor/extensions";
import { clearMermaidCache } from "@/lib/mermaid/mermaid-cache";
import { mermaidRenderCoordinator } from "@/lib/mermaid/mermaid-coordinator";
import { resetMermaidLoaderForTests, setMermaidLoaderForTests } from "@/lib/mermaid/mermaid-loader";

const createEditor = (content: Content = "") =>
  new Editor({
    extensions: createEditorExtensions(),
    content,
  });

const MERMAID_MARKDOWN = "```mermaid\ngraph TD; A-->B\n```";

describe("mermaid previews in the editor (ODE-533)", () => {
  beforeEach(() => {
    clearMermaidCache();
    resetMermaidLoaderForTests();
    mermaidRenderCoordinator.resetForTests();
    // happy-dom never fires real intersection; the coordinator is the single
    // observer owner in production, so tests stub it to report visible
    // immediately after observe (explicit preview request path).
    const ImmediateObserver = class {
      private callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        setTimeout(
          () =>
            this.callback(
              [{ isIntersecting: true, target } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            ),
          0,
        );
      }
      unobserve() {}
      disconnect() {}
    };
    vi.stubGlobal(
      "IntersectionObserver",
      ImmediateObserver as unknown as typeof IntersectionObserver,
    );
    setMermaidLoaderForTests(async () => ({
      initialize: () => {},
      render: async () => ({ svg: "<svg><g>diagram</g></svg>" }),
    }));
  });

  it("round-trips mermaid source as an ordinary fence without persisting preview state", () => {
    const editor = createEditor();
    editor.commands.setContent(MERMAID_MARKDOWN);
    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
        },
      ],
    });
    expect(getEditorMarkdown(editor)).toBe(MERMAID_MARKDOWN);
    editor.destroy();
  });

  it("shows a keyboard-reachable preview toggle only for mermaid fences", async () => {
    const editor = createEditor();
    editor.commands.setContent(MERMAID_MARKDOWN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const toggle = editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.getAttribute("aria-controls")).toMatch(/odessay-mermaid-preview-/);

    editor.commands.setContent("```js\nconst a = 1\n```");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const bar = editor.view.dom.querySelector<HTMLElement>(".odessay-mermaid-bar");
    expect(bar?.hidden).toBe(true);
    editor.destroy();
  });

  it("loads lazily on explicit request and keeps source editable", async () => {
    const render = vi.fn(async () => ({ svg: "<svg><g>lazy</g></svg>" }));
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));
    expect(render).not.toHaveBeenCalled();

    const editor = createEditor();
    editor.commands.setContent(MERMAID_MARKDOWN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // No preview requested yet: the renderer stays unloaded.
    expect(render).not.toHaveBeenCalled();

    editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle")?.click();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await vi.waitFor(
      () => expect(editor.view.dom.querySelector(".odessay-mermaid-svg svg")).not.toBeNull(),
      { timeout: 2000 },
    );
    // Source remains canonical and editable after render.
    expect(getEditorMarkdown(editor)).toBe(MERMAID_MARKDOWN);
    editor.destroy();
    setMermaidLoaderForTests(null);
  });

  it("discards stale renders when the source changes mid-render", async () => {
    let releaseRender!: (svg: string) => void;
    const renderGate = new Promise<string>((resolve) => {
      releaseRender = resolve;
    });
    const render = vi.fn(async () => ({ svg: await renderGate }));
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));

    const editor = createEditor();
    editor.commands.setContent(MERMAID_MARKDOWN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle")?.click();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1), { timeout: 2000 });

    // Edit the source while the first render is still in flight.
    editor.commands.setContent("```mermaid\ngraph TD; A-->C\n```");
    releaseRender("<svg><g>stale</g></svg>");
    await new Promise((resolve) => setTimeout(resolve, 30));
    // The stale SVG for A-->B must never commit over the edited source.
    expect(editor.view.dom.querySelector(".odessay-mermaid-svg")?.textContent ?? "").not.toContain("stale");
    expect(getEditorMarkdown(editor)).toBe("```mermaid\ngraph TD; A-->C\n```");
    editor.destroy();
    setMermaidLoaderForTests(null);
  });

  it("shows a retryable localized error and preserves source on invalid diagrams", async () => {
    setMermaidLoaderForTests(async () => ({
      initialize: () => {},
      render: async () => {
        throw new Error("Parse error on line 1");
      },
    }));
    const editor = createEditor();
    editor.commands.setContent(MERMAID_MARKDOWN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle")?.click();
    await vi.waitFor(
      () =>
        expect(
          editor.view.dom.querySelector<HTMLElement>(".odessay-mermaid-error")?.hidden,
        ).toBe(false),
      { timeout: 2000 },
    );
    expect(editor.view.dom.querySelector(".odessay-mermaid-error-text")?.textContent).toMatch(/Invalid diagram/);
    expect(editor.view.dom.querySelector(".odessay-mermaid-retry")).not.toBeNull();
    expect(getEditorMarkdown(editor)).toBe(MERMAID_MARKDOWN);
    editor.destroy();
    setMermaidLoaderForTests(null);
  });

  it("keeps preview UI state out of the serialized document", async () => {
    const editor = createEditor();
    editor.commands.setContent(MERMAID_MARKDOWN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle")?.click();
    await vi.waitFor(() => expect(editor.view.dom.querySelector(".odessay-mermaid-svg svg")).not.toBeNull(), {
      timeout: 2000,
    });
    const markdown = getEditorMarkdown(editor);
    expect(markdown).toBe(MERMAID_MARKDOWN);
    expect(markdown).not.toContain("odessay-mermaid");
    expect(markdown).not.toContain("<svg");
    editor.destroy();
  });
});
