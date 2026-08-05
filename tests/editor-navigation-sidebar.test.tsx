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

  it("uses one full-height structural shell for either mutually-exclusive mode", () => {
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
    expect(aside?.className).toContain("h-full");
    expect(aside?.className).toContain("border-r-[0.5px]");
    expect(aside?.className).not.toContain("rounded");
    expect(container.textContent).toContain("Contents");

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

  it("keeps mode controls visible while the sidebar is closed", () => {
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
    expect(container.querySelector("aside")).toBeNull();
    expect(container.textContent).toContain("Workspace");
    expect(container.textContent).not.toContain("hidden");
  });
});
