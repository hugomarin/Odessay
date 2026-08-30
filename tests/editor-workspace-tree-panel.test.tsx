/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextualWorkspace } from "@/lib/workspace/types";

const loadContextualWorkspace = vi.fn();
const refreshContextualWorkspaceDocuments = vi.fn();
type CatalogListener = (change: {
  transactionId: string;
  documentIds: string[];
  reason: "upsert" | "detach" | "cloud-snapshot" | "migration" | "bulk";
  occurredAt: number;
}) => void;
const catalogListeners = new Set<CatalogListener>();

vi.mock("@/lib/services/workspace-service", () => ({
  loadContextualWorkspace: (id: string) => loadContextualWorkspace(id),
  refreshContextualWorkspaceDocuments: (
    workspace: ContextualWorkspace,
    ids: string[],
  ) => refreshContextualWorkspaceDocuments(workspace, ids),
  subscribeToContextualWorkspaceChanges: (listener: CatalogListener) => {
    catalogListeners.add(listener);
    return () => catalogListeners.delete(listener);
  },
}));

/** Emit a catalog change the way the SQLite catalog does after a save. */
function emitCatalogChange(
  documentIds: string[],
  reason: "upsert" | "bulk" | "detach" = "upsert",
) {
  for (const listener of catalogListeners) {
    listener({
      transactionId: `tx-${Math.random()}`,
      documentIds,
      reason,
      occurredAt: Date.now(),
    });
  }
}

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

const found = (
  documents: ContextualWorkspace["documents"],
  overrides: Partial<ContextualWorkspace> = {},
) => ({ kind: "workspace" as const, workspace: workspaceWith(documents, overrides) });

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
    refreshContextualWorkspaceDocuments.mockReset();
    refreshContextualWorkspaceDocuments.mockResolvedValue(null);
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

  const render = (
    activeWritingId: string | null,
    onOpen = vi.fn(),
    onCountChange = vi.fn(),
  ) =>
    act(() => {
      root.render(
        <WorkspaceTreePanel
          activeWritingId={activeWritingId}
          onOpenDocument={onOpen}
          onCountChange={onCountChange}
        />,
      );
    });

  const settle = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("renders folders and files in Studio mode", async () => {
    loadContextualWorkspace.mockResolvedValue(
      found([activeDocument, siblingDocument]),
    );

    render(ACTIVE_ID);
    await settle();

    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    );
    const rowText = rows.map((row) => row.textContent?.trim());
    // Folders appear
    expect(rowText.some((name) => name?.includes("03-analisis"))).toBe(true);
    expect(rowText.some((name) => name?.includes("04-sesiones"))).toBe(true);
    // Files also appear in Studio mode (not foldersOnly)
    expect(rowText.some((name) => name?.includes("aplyca-analisis"))).toBe(true);
    expect(rowText.some((name) => name?.includes("sesion"))).toBe(true);
  });

  it("shows a non-actionable empty state when there is no active writing", async () => {
    render(null);
    await settle();

    expect(container.textContent).toContain("No active artifact.");
    expect(loadContextualWorkspace).not.toHaveBeenCalled();
  });

  it("keeps Workspace mode with an empty state when the writing has no Workspace", async () => {
    loadContextualWorkspace.mockResolvedValue({ kind: "no-membership" });

    render(ACTIVE_ID);
    await settle();

    expect(container.textContent).toContain(
      "This artifact does not belong to a workspace.",
    );
    expect(container.querySelector('[role="tree"]')).toBeNull();
  });

  it("reports an unavailable root without treating it as an empty Workspace", async () => {
    loadContextualWorkspace.mockResolvedValue(
      found([activeDocument], {
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

  it("reports no document count for an unavailable root", async () => {
    const onCountChange = vi.fn();
    loadContextualWorkspace.mockResolvedValue(
      found([activeDocument], {
        status: "missing",
        missingReason: "Workspace folder is unavailable",
      }),
    );

    render(ACTIVE_ID, vi.fn(), onCountChange);
    await settle();

    // A `0` badge beside the name reads as "this Workspace is empty", which is
    // the confusion the unavailable state exists to prevent.
    expect(onCountChange).toHaveBeenCalledWith(undefined);
    expect(onCountChange).not.toHaveBeenCalledWith(0);
  });

  it("surfaces a recoverable error with retry instead of collapsing the panel", async () => {
    loadContextualWorkspace.mockRejectedValueOnce(new Error("catalog offline"));
    render(ACTIVE_ID);
    await settle();

    expect(container.textContent).toContain("catalog offline");

    loadContextualWorkspace.mockResolvedValue(found([activeDocument]));
    const retry = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Retry"));
    await act(async () => {
      retry?.click();
    });
    await settle();

    expect(container.querySelector('[role="tree"]')).not.toBeNull();
  });

  it("says Workspace is desktop-only instead of denying membership on web", async () => {
    loadContextualWorkspace.mockResolvedValue({ kind: "unsupported-runtime" });

    render(ACTIVE_ID);
    await settle();

    expect(container.textContent).toContain("only available in the desktop app");
    expect(container.textContent).not.toContain(
      "no pertenece a un Workspace",
    );
  });

  it("discards a stale response that resolves after the writing changed", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    loadContextualWorkspace
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(found([siblingDocument]));

    render(ACTIVE_ID);
    render(OTHER_ID);
    await settle();

    // The first writing's Workspace lands late — it must not overwrite the tree
    // that already belongs to the writing the author switched to.
    await act(async () => {
      resolveFirst(found([activeDocument], { name: "Workspace anterior" }));
    });
    await settle();

    expect(container.textContent).toContain("sesion");
    expect(container.textContent).not.toContain("Workspace anterior");
    expect(container.textContent).not.toContain("aplyca-analisis");
  });

  it("coalesces a burst of catalog changes into a single refresh", async () => {
    loadContextualWorkspace.mockResolvedValue(found([activeDocument]));

    render(ACTIVE_ID);
    await settle();

    for (let index = 0; index < 8; index += 1) {
      act(() => emitCatalogChange([OTHER_ID]));
      await act(async () => {
        vi.advanceTimersByTime(40);
      });
    }
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await settle();

    expect(refreshContextualWorkspaceDocuments).toHaveBeenCalledTimes(1);
  });

  it("never rescans the root for discrete autosaves of the active writing", async () => {
    loadContextualWorkspace.mockResolvedValue(found([activeDocument]));

    render(ACTIVE_ID);
    await settle();
    expect(loadContextualWorkspace).toHaveBeenCalledTimes(1);

    // The real trigger is not a burst: each autosave is its own event, seconds
    // apart, so every one opens a fresh debounce window. Resolving those
    // through the scanning loader would rescan the whole Workspace root — a
    // second full scan right after the one `persist` already did.
    for (let index = 0; index < 3; index += 1) {
      act(() => emitCatalogChange([ACTIVE_ID]));
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      await settle();
    }

    expect(loadContextualWorkspace).toHaveBeenCalledTimes(1);
    expect(refreshContextualWorkspaceDocuments).toHaveBeenCalledTimes(3);
    for (const call of refreshContextualWorkspaceDocuments.mock.calls) {
      expect(call[1]).toContain(ACTIVE_ID);
    }
    // The tree stayed on screen the whole time: no loading state, no remount.
    expect(container.querySelector('[role="tree"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Loading workspace");
  });

  it("keeps folders the author collapsed across a tree rebuild", async () => {
    const nested = {
      ...siblingDocument,
      relativePath: "04-sesiones/sesion.md",
    };
    loadContextualWorkspace.mockResolvedValue(found([activeDocument, nested]));

    render(ACTIVE_ID);
    await settle();

    const folder = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    ).find((row) => row.textContent?.includes("04-sesiones"));
    await act(async () => {
      folder?.click();
    });
    expect(folder?.getAttribute("aria-expanded")).toBe("false");
    const documentRows = () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
      ).map((row) => row.textContent?.trim());
    expect(documentRows()).not.toContain("sesion");

    // A reconciled add/move/remove legitimately rebuilds the tree. The author's
    // collapsed folders must survive it.
    refreshContextualWorkspaceDocuments.mockResolvedValueOnce(
      workspaceWith([
        activeDocument,
        nested,
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "nuevo.md",
          relativePath: "nuevo.md",
          state: "synced" as const,
          openable: true,
        },
      ]),
    );
    act(() => emitCatalogChange(["33333333-3333-4333-8333-333333333333"]));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await settle();

    // Root-level files are not shown in foldersOnly mode, but the folder
    // collapse state must survive the rebuild.
    const rebuilt = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    ).find((row) => row.textContent?.includes("04-sesiones"));
    expect(rebuilt?.getAttribute("aria-expanded")).toBe("false");
  });
});
