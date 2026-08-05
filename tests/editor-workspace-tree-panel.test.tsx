/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextualWorkspace } from "@/lib/workspace/types";

const loadContextualWorkspace = vi.fn();
const catalogListeners = new Set<() => void>();

vi.mock("@/lib/services/workspace-service", () => ({
  loadContextualWorkspace: (id: string) => loadContextualWorkspace(id),
  subscribeToContextualWorkspaceChanges: (listener: () => void) => {
    catalogListeners.add(listener);
    return () => catalogListeners.delete(listener);
  },
}));

const { WorkspaceTreePanel } = await import(
  "@/components/editor/panels/workspace-tree-panel"
);

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ACTIVE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function workspaceWith(
  documents: ContextualWorkspace["documents"],
  overrides: Partial<ContextualWorkspace> = {},
): ContextualWorkspace {
  return {
    slug: "aplyca",
    name: "Aplyca",
    status: "ready",
    missingReason: null,
    documents,
    ...overrides,
  };
}

const activeDocument = {
  id: ACTIVE_ID,
  name: "aplyca-analisis.md",
  relativePath: "03-analisis/aplyca-analisis.md",
  state: "synced" as const,
  openable: true,
};

const siblingDocument = {
  id: OTHER_ID,
  name: "sesion.md",
  relativePath: "04-sesiones/sesion.md",
  state: "synced" as const,
  openable: true,
};

describe("WorkspaceTreePanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    loadContextualWorkspace.mockReset();
    catalogListeners.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const render = (activeWritingId: string | null, onOpen = vi.fn()) =>
    act(() => {
      root.render(
        <WorkspaceTreePanel
          activeWritingId={activeWritingId}
          onOpenDocument={onOpen}
          onCountChange={vi.fn()}
        />,
      );
    });

  const settle = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("marks the active writing as the selected tree row", async () => {
    loadContextualWorkspace.mockResolvedValue(
      workspaceWith([activeDocument, siblingDocument]),
    );

    render(ACTIVE_ID);
    await settle();

    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    );
    const active = rows.find((row) =>
      row.textContent?.includes("aplyca-analisis"),
    );
    const sibling = rows.find((row) => row.textContent?.includes("sesion"));

    expect(active?.getAttribute("aria-selected")).toBe("true");
    expect(active?.getAttribute("aria-current")).toBe("page");
    expect(active?.className).toContain("bg-muted");
    expect(sibling?.getAttribute("aria-selected")).toBe("false");
    expect(sibling?.getAttribute("aria-current")).toBeNull();
  });

  it("shows a non-actionable empty state when there is no active writing", async () => {
    render(null);
    await settle();

    expect(container.textContent).toContain("No hay un writing activo.");
    expect(loadContextualWorkspace).not.toHaveBeenCalled();
  });

  it("keeps Workspace mode with an empty state when the writing has no Workspace", async () => {
    loadContextualWorkspace.mockResolvedValue(null);

    render(ACTIVE_ID);
    await settle();

    expect(container.textContent).toContain(
      "Este writing no pertenece a un Workspace.",
    );
    expect(container.querySelector('[role="tree"]')).toBeNull();
  });

  it("reports an unavailable root without treating it as an empty Workspace", async () => {
    loadContextualWorkspace.mockResolvedValue(
      workspaceWith([activeDocument], {
        status: "missing",
        missingReason: "La carpeta ya no existe en disco.",
      }),
    );

    render(ACTIVE_ID);
    await settle();

    expect(container.textContent).toContain("Aplyca no está disponible.");
    expect(container.textContent).toContain("La carpeta ya no existe en disco.");
    expect(container.querySelector('[role="tree"]')).toBeNull();
  });

  it("surfaces a recoverable error with retry instead of collapsing the panel", async () => {
    loadContextualWorkspace.mockRejectedValueOnce(new Error("catalog offline"));
    render(ACTIVE_ID);
    await settle();

    expect(container.textContent).toContain("catalog offline");

    loadContextualWorkspace.mockResolvedValue(workspaceWith([activeDocument]));
    const retry = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Reintentar"));
    await act(async () => {
      retry?.click();
    });
    await settle();

    expect(container.querySelector('[role="tree"]')).not.toBeNull();
  });

  it("discards a stale response that resolves after the writing changed", async () => {
    let resolveFirst: (value: ContextualWorkspace) => void = () => {};
    loadContextualWorkspace
      .mockImplementationOnce(
        () =>
          new Promise<ContextualWorkspace>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(workspaceWith([siblingDocument]));

    render(ACTIVE_ID);
    render(OTHER_ID);
    await settle();

    // The first writing's Workspace lands late — it must not overwrite the tree
    // that already belongs to the writing the author switched to.
    await act(async () => {
      resolveFirst(
        workspaceWith([activeDocument], { name: "Workspace anterior" }),
      );
    });
    await settle();

    expect(container.textContent).toContain("sesion");
    expect(container.textContent).not.toContain("Workspace anterior");
    expect(container.textContent).not.toContain("aplyca-analisis");
  });

  it("coalesces a burst of catalog changes into a single tree rebuild", async () => {
    loadContextualWorkspace.mockResolvedValue(workspaceWith([activeDocument]));

    render(ACTIVE_ID);
    await settle();
    expect(loadContextualWorkspace).toHaveBeenCalledTimes(1);

    // One bulk reconciliation emits notifications spread over time, each gap
    // shorter than the 100ms debounce window. Every notification must push the
    // rebuild forward rather than queue its own — otherwise a long burst
    // reloads the tree repeatedly while the author is typing.
    for (let index = 0; index < 8; index += 1) {
      act(() => {
        catalogListeners.forEach((listener) => listener());
      });
      await act(async () => {
        vi.advanceTimersByTime(40);
      });
    }
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await settle();

    expect(loadContextualWorkspace).toHaveBeenCalledTimes(2);
  });
});
