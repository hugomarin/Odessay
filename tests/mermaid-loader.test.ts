import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMermaidCache } from "@/lib/mermaid/mermaid-cache";
import {
  MermaidRenderError,
  getMermaidRenderCountForTests,
  renderMermaidSvg,
  resetMermaidLoaderForTests,
  setMermaidLoaderForTests,
} from "@/lib/mermaid/mermaid-loader";

describe("mermaid loader (ODE-533)", () => {
  beforeEach(() => {
    clearMermaidCache();
    resetMermaidLoaderForTests();
    setMermaidLoaderForTests(null);
  });

  it("caches successful renders so repeated sources do not reload", async () => {
    const render = vi.fn(async (_id: string, _text: string) => ({ svg: "<svg><g>ok</g></svg>" }));
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));
    const first = await renderMermaidSvg("graph TD; A-->B");
    const second = await renderMermaidSvg("graph TD; A-->B");
    expect(first).toBe("<svg><g>ok</g></svg>");
    expect(second).toBe(first);
    expect(render).toHaveBeenCalledTimes(1);
    expect(getMermaidRenderCountForTests()).toBe(1);
    setMermaidLoaderForTests(null);
  });

  it(" surfaces invalid diagrams without caching the failure", async () => {
    const render = vi.fn(async () => {
      throw new Error("Parse error on line 1");
    });
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));
    await expect(renderMermaidSvg("not a diagram [[[")).rejects.toMatchObject({ code: "invalid" });
    // A second attempt retries the renderer instead of serving a cached error.
    await expect(renderMermaidSvg("not a diagram [[[")).rejects.toMatchObject({ code: "invalid" });
    expect(render).toHaveBeenCalledTimes(2);
    setMermaidLoaderForTests(null);
  });

  it("rejects unsafe SVG and never caches it", async () => {
    const render = vi.fn(async () => ({ svg: `<svg><script>alert(1)</script></svg>` }));
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));
    await expect(renderMermaidSvg("graph TD; A-->B")).rejects.toMatchObject({ code: "unsafe" });
    const safeRender = vi.fn(async () => ({ svg: "<svg><g>safe</g></svg>" }));
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render: safeRender }));
    await expect(renderMermaidSvg("graph TD; A-->B")).resolves.toBe("<svg><g>safe</g></svg>");
    expect(safeRender).toHaveBeenCalledTimes(1);
    setMermaidLoaderForTests(null);
  });

  it("times out slow renders", async () => {
    const render = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { svg: "<svg></svg>" };
    });
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));
    await expect(renderMermaidSvg("graph TD; A-->B", { timeoutMs: 5 })).rejects.toMatchObject({
      code: "timeout",
    });
    setMermaidLoaderForTests(null);
  });

  it("reports renderer load failures without blocking editing", async () => {
    setMermaidLoaderForTests(async () => {
      throw new Error("chunk failed");
    });
    const failure = await renderMermaidSvg("graph TD; A-->B").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MermaidRenderError);
    expect((failure as MermaidRenderError).code).toBe("load-failed");
    setMermaidLoaderForTests(null);
  });

  it("rejects empty and oversized sources before loading", async () => {
    const render = vi.fn(async () => ({ svg: "<svg></svg>" }));
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));
    await expect(renderMermaidSvg("   ")).rejects.toMatchObject({ code: "empty-source" });
    await expect(renderMermaidSvg("x".repeat(20001))).rejects.toMatchObject({ code: "too-large" });
    expect(render).not.toHaveBeenCalled();
    setMermaidLoaderForTests(null);
  });
});
