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

  it.fails("renders concurrent Mermaid blocks independently through their NodeViews", async () => {
    let releaseRenders!: () => void;
    const renderGate = new Promise<void>((resolve) => {
      releaseRenders = resolve;
    });
    const render = vi.fn(async (_id: string, source: string) => {
      await renderGate;
      return {
        svg: source.includes("A-->B") ? "<svg><g>owner-a</g></svg>" : "<svg><g>owner-b</g></svg>",
      };
    });
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));

    const editor = createEditor();
    const sourceA = "```mermaid\ngraph TD; A-->B\n```";
    const sourceB = "```mermaid\ngraph TD; C-->D\n```";
    const markdown = `${sourceA}\n\n${sourceB}`;
    editor.commands.setContent(markdown);
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      const toggles = Array.from(editor.view.dom.querySelectorAll<HTMLButtonElement>(".odessay-mermaid-toggle"));
      expect(toggles).toHaveLength(2);
      toggles.forEach((toggle) => toggle.click());
      await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2), { timeout: 2000 });
      releaseRenders();
      await vi.waitFor(
        () => expect(editor.view.dom.querySelectorAll(".odessay-mermaid-svg svg")).toHaveLength(2),
        { timeout: 2000 },
      );

      const rendered = Array.from(editor.view.dom.querySelectorAll<SVGElement>(".odessay-mermaid-svg svg"))
        .map((svg) => svg.textContent)
        .sort();
      expect(rendered).toEqual(["owner-a", "owner-b"]);
      expect(getEditorMarkdown(editor)).toBe(markdown);
    } finally {
      editor.destroy();
      setMermaidLoaderForTests(null);
    }
  });

  it("discards stale renders when the source changes mid-render", async () => {
    let releaseOldRender!: (svg: string) => void;
    let completeOldRender!: () => void;
    const oldRenderGate = new Promise<string>((resolve) => {
      releaseOldRender = resolve;
    });
    const oldRenderComplete = new Promise<void>((resolve) => {
      completeOldRender = resolve;
    });
    const render = vi.fn(async (_id: string, source: string) => {
      if (source.includes("A-->B")) {
        const svg = await oldRenderGate;
        completeOldRender();
        return { svg };
      }
      return { svg: "<svg><g>fresh</g></svg>" };
    });
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));

    const editor = createEditor();
    editor.commands.setContent(MERMAID_MARKDOWN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle")?.click();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1), { timeout: 2000 });

    // Edit the source while the first render is still in flight.
    const originalNodeView = editor.view.dom.querySelector<HTMLElement>(".odessay-code-block");
    expect(originalNodeView).not.toBeNull();
    const editedMarkdown = "```mermaid\ngraph TD; A-->C\n```";
    editor.commands.setContent(editedMarkdown);
    expect(editor.view.dom.querySelector(".odessay-code-block")).toBe(originalNodeView);

    // The stale result settles before a newer request can supersede its owner token.
    releaseOldRender("<svg><g>stale</g></svg>");
    await oldRenderComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.view.dom.querySelector(".odessay-mermaid-svg")?.textContent ?? "").not.toContain("stale");
    expect(getEditorMarkdown(editor)).toBe(editedMarkdown);

    // A current-source request remains reachable and completes in this setup.
    const toggle = editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle");
    if (toggle?.getAttribute("aria-expanded") === "true") toggle.click();
    editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle")?.click();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await vi.waitFor(() => expect(editor.view.dom.querySelector(".odessay-mermaid-svg")?.textContent).toContain("fresh"), {
      timeout: 2000,
    });
    editor.destroy();
    setMermaidLoaderForTests(null);
  });

  it("does not carry a pending render into replacement editor content", async () => {
    let releaseOldRender!: (svg: string) => void;
    let completeOldRender!: () => void;
    const oldRenderGate = new Promise<string>((resolve) => {
      releaseOldRender = resolve;
    });
    const oldRenderComplete = new Promise<void>((resolve) => {
      completeOldRender = resolve;
    });
    const render = vi.fn(async (_id: string, source: string) => {
      if (source.includes("A-->B")) {
        const svg = await oldRenderGate;
        completeOldRender();
        return { svg };
      }
      return { svg: "<svg><g>document-b</g></svg>" };
    });
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));

    const editor = createEditor();
    const documentA = "# Document A\n\n```mermaid\ngraph TD; A-->B\n```";
    const documentB = "# Document B\n\n```mermaid\ngraph TD; C-->D\n```";
    editor.commands.setContent(documentA);
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle")?.click();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1), { timeout: 2000 });

    try {
      // Replace the full editor document while its previous document is rendering.
      editor.commands.setContent(documentB);
      const toggle = editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle");
      if (toggle?.getAttribute("aria-expanded") === "true") toggle.click();
      editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle")?.click();
      await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2), { timeout: 2000 });
      await vi.waitFor(
        () => expect(editor.view.dom.querySelector(".odessay-mermaid-svg")?.textContent).toContain("document-b"),
        { timeout: 2000 },
      );

      releaseOldRender("<svg><g>document-a-stale</g></svg>");
      await oldRenderComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(editor.view.dom.querySelector(".odessay-mermaid-svg")?.textContent).toContain("document-b");
      expect(editor.view.dom.textContent).not.toContain("document-a-stale");
      expect(getEditorMarkdown(editor)).toBe(documentB);
    } finally {
      editor.destroy();
      setMermaidLoaderForTests(null);
    }
  });

  it("does not commit a pending render after its NodeView unmounts", async () => {
    let releaseRender!: (svg: string) => void;
    let completeRender!: () => void;
    const renderGate = new Promise<string>((resolve) => {
      releaseRender = resolve;
    });
    const renderComplete = new Promise<void>((resolve) => {
      completeRender = resolve;
    });
    const render = vi.fn(async () => {
      const svg = await renderGate;
      completeRender();
      return { svg };
    });
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));

    const editor = createEditor();
    editor.commands.setContent(MERMAID_MARKDOWN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.view.dom.querySelector<HTMLButtonElement>(".odessay-mermaid-toggle")?.click();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const preview = editor.view.dom.querySelector<HTMLElement>(".odessay-mermaid-preview");
    expect(preview).not.toBeNull();

    editor.destroy();
    releaseRender("<svg><g>after-unmount</g></svg>");
    await renderComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(preview?.querySelector(".odessay-mermaid-svg")).toBeNull();
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
