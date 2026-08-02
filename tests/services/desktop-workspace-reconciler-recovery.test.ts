/**
 * @contract ODE-408 — durable Workspace removal recovery
 * @doc workflow/context/features/odessay-desktop-document-catalog.md
 * @service WorkspaceReconciler startup recovery
 */
import { describe, expect, it, vi } from "vitest"
import { recoverInterruptedWorkspaceRemovals } from "@/lib/services/desktop/desktop-workspace-reconciler"
import type { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"
import type { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"

describe("workspace removal startup recovery (ODE-408)", () => {
  it("finishes Settings cleanup from a durable retired-root record before watchers start", async () => {
    const updateDesktopSettings = vi.fn(async (patch) => ({ data: patch, error: null }))
    const settings = {
      getDesktopSettings: vi.fn(async () => ({
        data: {
          disabledStatuses: [],
          workspaces: [
            { slug: "removed", name: "Removed", rootPath: "/Users/me/Removed" },
            { slug: "kept", name: "Kept", rootPath: "/Users/me/Kept" },
          ],
          workspaceAssignments: { "doc-1": "removed", "doc-2": "kept" },
          bindingRoots: [
            { id: "root-removed", rootPath: "/Users/me/Removed/" },
            { id: "root-kept", rootPath: "/Users/me/Kept" },
          ],
        },
        error: null,
      })),
      updateDesktopSettings,
    } as unknown as DesktopSettingsService
    const catalog = {
      listRetiredBindingRoots: vi.fn(async () => [
        { id: "root-removed", rootPath: "/Users/me/Removed", retiredAt: 10 },
      ]),
    } as unknown as SqliteDocumentCatalog

    await recoverInterruptedWorkspaceRemovals(settings, catalog)

    expect(updateDesktopSettings).toHaveBeenCalledWith({
      workspaces: [expect.objectContaining({ slug: "kept" })],
      workspaceAssignments: { "doc-2": "kept" },
      bindingRoots: [expect.objectContaining({ id: "root-kept" })],
    })
  })
})
