/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-382 — shared Desk/Workspace writing hierarchy
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ArtifactWritingAction,
  ArtifactWritingCell,
} from "@/components/shared/artifact-writing-cell";
import { DocumentStateTooltipProvider } from "@/components/ui/document-state-badge";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  vi.unstubAllGlobals();
  root = null;
  container.remove();
});

describe("ArtifactWritingCell", () => {
  it("keeps title, state and actions adjacent while exposing description and metadata", () => {
    const onAction = vi.fn();

    act(() => {
      root?.render(
        <DocumentStateTooltipProvider>
          <ArtifactWritingCell
            title="Post costos GPT 5.6"
            documentState="synced"
            description="Escoger bien el modelo puede optimizar mucho más tu presupuesto."
            dateLabel="Yesterday"
            actions={
              <ArtifactWritingAction label="Rename writing" onClick={onAction}>
                Edit
              </ArtifactWritingAction>
            }
            collections={<span data-testid="collections">Posts</span>}
          />
        </DocumentStateTooltipProvider>,
      );
    });

    const cell = container.querySelector(".ArtifactWritingCell");
    const title = Array.from(container.querySelectorAll("p")).find(
      (element) => element.textContent === "Post costos GPT 5.6",
    );
    const state = container.querySelector('[role="status"]');
    const action = container.querySelector(
      'button[aria-label="Rename writing"]',
    );

    expect(cell).not.toBeNull();
    expect(title?.parentElement).toBe(state?.parentElement);
    expect(title?.parentElement).toBe(action?.parentElement?.parentElement);
    expect(title?.className).not.toContain("flex-1");
    expect(container.textContent).toContain(
      "Escoger bien el modelo puede optimizar mucho más tu presupuesto.",
    );
    expect(container.textContent).toContain("Yesterday");
    expect(
      container.querySelector('[data-testid="collections"]')?.textContent,
    ).toBe("Posts");

    act(() =>
      action?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("renders visual-only actions as explicitly disabled controls", () => {
    const onAction = vi.fn();

    act(() => {
      root?.render(
        <ArtifactWritingAction
          disabled
          label="Preview writing (coming soon)"
          onClick={onAction}
        >
          Preview
        </ArtifactWritingAction>,
      );
    });

    const action = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Preview writing (coming soon)"]',
    );

    expect(action?.disabled).toBe(true);
    expect(action?.title).toBe("Preview writing (coming soon)");
    act(() => action?.click());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("loads a description on demand when catalog metadata has no excerpt", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const loadDescription = vi
      .fn()
      .mockResolvedValue(
        "Escoger bien el modelo puede optimizar mucho más tu presupuesto.",
      );

    await act(async () => {
      root?.render(
        <DocumentStateTooltipProvider>
          <ArtifactWritingCell
            title="Post costos GPT 5.6"
            documentState="synced"
            loadDescription={loadDescription}
          />
        </DocumentStateTooltipProvider>,
      );
      await Promise.resolve();
    });

    expect(loadDescription).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "Escoger bien el modelo puede optimizar mucho más tu presupuesto.",
    );
  });
});
