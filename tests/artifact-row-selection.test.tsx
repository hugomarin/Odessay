/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-382 — shared Desk/Workspace leading selection affordance
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactRowSelection } from "@/components/shared/artifact-row-selection";

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
  root = null;
  container.remove();
});

describe("ArtifactRowSelection", () => {
  it("uses the same markup for an enabled Desk checkbox and a disabled Workspace affordance", () => {
    const onToggle = vi.fn();

    act(() => {
      root?.render(
        <div>
          <ArtifactRowSelection
            label="Select Desk writing"
            onToggle={onToggle}
          />
          <ArtifactRowSelection
            disabled
            label="Select Workspace writing (coming soon)"
          />
        </div>,
      );
    });

    const controls = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".ArtifactRowSelection"),
    );
    expect(controls).toHaveLength(2);
    expect(controls[0]?.disabled).toBe(false);
    expect(controls[1]?.disabled).toBe(true);
    expect(controls[0]?.innerHTML).toBe(controls[1]?.innerHTML);

    act(() => controls[0]?.click());
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
