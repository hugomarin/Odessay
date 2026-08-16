/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditorNavigationSidebar,
  NavigationModeButton,
} from "@/components/editor/panels/editor-navigation-sidebar";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("EditorNavigationSidebar", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses one structural shell for either mutually-exclusive mode", () => {
    act(() =>
      root.render(
        <EditorNavigationSidebar
          mode="toc"
          title="Contents"
          count={3}
          controls={
            <NavigationModeButton active label="TOC" onClick={vi.fn()}>
              T
            </NavigationModeButton>
          }
          onClose={vi.fn()}
        >
          <p>TOC body</p>
        </EditorNavigationSidebar>,
      ),
    );
    const aside = container.querySelector("aside");
    // ODE-433: the panel is a 236px column of the band, not an absolute overlay
    // over the sheet — transparent, clipped, and never rounded.
    expect(aside?.dataset.open).toBe("true");
    expect(aside?.className).toContain("w-[var(--size-panel-left)]");
    expect(aside?.className).toContain("overflow-hidden");
    expect(aside?.className).toContain("bg-transparent");
    expect(aside?.className).not.toContain("rounded");
    expect(container.textContent).toContain("Contents");
    expect(container.textContent).toContain("3");

    act(() =>
      root.render(
        <EditorNavigationSidebar
          mode="workspace"
          title="Workspace"
          controls={<span>controls</span>}
          onClose={vi.fn()}
        >
          <p>Tree body</p>
        </EditorNavigationSidebar>,
      ),
    );
    expect(container.textContent).not.toContain("TOC body");
    expect(container.textContent).toContain("Tree body");
  });

  it("collapses to an inert zero-width column when no panel is open", () => {
    act(() =>
      root.render(
        <EditorNavigationSidebar
          mode={null}
          title="Contents"
          controls={<button>Workspace</button>}
          onClose={vi.fn()}
        >
          <p>hidden</p>
        </EditorNavigationSidebar>,
      ),
    );

    const aside = container.querySelector("aside");
    expect(aside?.dataset.open).toBe("false");
    expect(aside?.className).toContain("w-0");
    expect(aside?.className).toContain("opacity-0");
    expect(aside?.className).toContain("pointer-events-none");
    // The toggles a closed panel used to hold now live in the sheet's ghost
    // rail and header row, so the collapsed column takes no space at all.
    expect(aside?.className).toContain("p-0");
  });

  it("contains the scroll gesture of the open panel", () => {
    act(() =>
      root.render(
        <EditorNavigationSidebar
          mode="toc"
          title="Contents"
          controls={<span>controls</span>}
          onClose={vi.fn()}
        >
          <p>TOC body</p>
        </EditorNavigationSidebar>,
      ),
    );

    const scroller = Array.from(container.querySelectorAll("div")).find((element) =>
      element.className.includes("overflow-y-auto"),
    );

    expect(scroller?.className).toContain("overscroll-contain");
    expect(scroller?.className).toContain("min-h-0");
  });
});
