/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMermaidCache } from "@/lib/mermaid/mermaid-cache";
import { mermaidRenderCoordinator } from "@/lib/mermaid/mermaid-coordinator";
import { resetMermaidLoaderForTests, setMermaidLoaderForTests } from "@/lib/mermaid/mermaid-loader";

/**
 * ODE-533 performance evidence (design/scale level per skill-performance):
 * - Mermaid is excluded from editor bootstrap (dynamic import only).
 * - Repeated renders hit the O(1) cache; visible/requested M scales, not C.
 */
describe("mermaid performance contract (ODE-533)", () => {
  beforeEach(() => {
    clearMermaidCache();
    resetMermaidLoaderForTests();
    mermaidRenderCoordinator.resetForTests();
    setMermaidLoaderForTests(null);
  });

  it("excludes Mermaid from editor bootstrap via dynamic import", () => {
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    const editorAdapter = stripComments(readFileSync("lib/editor/document-component-extensions.ts", "utf8"));
    const coordinator = stripComments(readFileSync("lib/mermaid/mermaid-coordinator.ts", "utf8"));
    const loader = stripComments(readFileSync("lib/mermaid/mermaid-loader.ts", "utf8"));

    // No static renderer import in the editor hot path or its coordinator.
    // Internal `@/lib/mermaid/*` adapter imports are expected and carry no
    // renderer cost; only the bare `mermaid` package specifier is forbidden.
    for (const source of [editorAdapter, coordinator, loader]) {
      expect(source).not.toMatch(/from\s+["']mermaid["']/);
      expect(source).not.toMatch(/require\(\s*["']mermaid["']\s*\)/);
    }
    // The only load path is a dynamic import on explicit request/visibility.
    expect(`${editorAdapter}\n${coordinator}`).toMatch(/import\(["']@\/lib\/mermaid\/mermaid-coordinator["']\)/);
    expect(loader).toMatch(/import\(["']mermaid["']\)/);
  });

  it("serves repeated renders from cache without renderer work", async () => {
    const render = vi.fn(async () => ({ svg: "<svg><g>once</g></svg>" }));
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));

    const sources = ["graph TD; A-->B", "graph TD; A-->C", "graph TD; A-->B", "graph TD; A-->B"];
    for (const source of sources) {
      const revision = mermaidRenderCoordinator.nextRevision();
      await mermaidRenderCoordinator.requestRender(source, revision);
    }
    // Two distinct sources rendered once each; repeats served from cache.
    expect(render).toHaveBeenCalledTimes(2);
    setMermaidLoaderForTests(null);
  });

  it("coordinates many blocks through one owner without per-block listeners", () => {
    const elements = Array.from({ length: 10 }, () => document.createElement("div"));
    document.body.append(...elements);
    const releases = elements.map((element) => mermaidRenderCoordinator.observe(element, () => {}));
    expect(mermaidRenderCoordinator.getObservedCountForTests()).toBe(10);
    for (const release of releases) release();
    expect(mermaidRenderCoordinator.getObservedCountForTests()).toBe(0);
    for (const element of elements) element.remove();
  });
});
