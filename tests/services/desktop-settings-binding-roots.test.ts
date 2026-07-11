import { beforeEach, describe, expect, it, vi } from "vitest"

// In-memory backing store for the Tauri settings commands so the BindingRoot
// accessors (ODE-370) can be exercised without Tauri.
const settingsMocks = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  return {
    store,
    tauriSettingsRead: vi.fn(async (_dir: string, key: string) =>
      store.has(key) ? store.get(key) : null,
    ),
    tauriSettingsWrite: vi.fn(async (_dir: string, key: string, value: unknown) => {
      store.set(key, value)
    }),
    tauriSettingsDelete: vi.fn(async (_dir: string, key: string) => {
      store.delete(key)
    }),
  }
})

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriSettingsRead: settingsMocks.tauriSettingsRead,
  tauriSettingsWrite: settingsMocks.tauriSettingsWrite,
  tauriSettingsDelete: settingsMocks.tauriSettingsDelete,
}))

import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"

describe("DesktopSettingsService BindingRoots (ODE-370)", () => {
  let service: DesktopSettingsService

  beforeEach(() => {
    settingsMocks.store.clear()
    service = new DesktopSettingsService("/tmp/cfg")
  })

  it("creates exactly one managed root that is never a Workspace", async () => {
    const managed = await service.ensureManagedRoot("/tmp/cfg/managed")
    expect(managed).toMatchObject({
      kind: "managed",
      visibleAsWorkspace: false,
      consentedAt: null,
    })

    // Idempotent: a second call returns the same record, not a duplicate.
    const again = await service.ensureManagedRoot("/tmp/cfg/managed-other")
    expect(again.id).toBe(managed.id)
    const roots = await service.getBindingRoots()
    expect(roots.filter((r) => r.kind === "managed")).toHaveLength(1)
  })

  it("keeps external root consent and workspace visibility independent", async () => {
    await service.ensureManagedRoot("/tmp/cfg/managed")
    await service.upsertBindingRoot({
      id: "ext-1",
      rootPath: "/Users/h/Letters",
      kind: "external",
      visibleAsWorkspace: true,
      selectedPaths: ["Drafts"],
      consentedAt: "2026-07-10T00:00:00.000Z",
      createdAt: "2026-07-10T00:00:00.000Z",
    })

    const roots = await service.getBindingRoots()
    const external = roots.find((r) => r.id === "ext-1")
    expect(external).toMatchObject({
      kind: "external",
      visibleAsWorkspace: true,
      selectedPaths: ["Drafts"],
      consentedAt: "2026-07-10T00:00:00.000Z",
    })
    // Managed root still present alongside the external one.
    expect(roots).toHaveLength(2)
  })

  it("upserts a BindingRoot by id without dropping other roots", async () => {
    await service.upsertBindingRoot({
      id: "ext-1",
      rootPath: "/Users/h/A",
      kind: "external",
      visibleAsWorkspace: false,
      selectedPaths: [],
      consentedAt: "2026-07-10T00:00:00.000Z",
      createdAt: "2026-07-10T00:00:00.000Z",
    })
    await service.upsertBindingRoot({
      id: "ext-1",
      rootPath: "/Users/h/A",
      kind: "external",
      visibleAsWorkspace: true,
      selectedPaths: ["Notes"],
      consentedAt: "2026-07-10T00:00:00.000Z",
      createdAt: "2026-07-10T00:00:00.000Z",
    })

    const roots = await service.getBindingRoots()
    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({ visibleAsWorkspace: true, selectedPaths: ["Notes"] })
  })

  it("converges an older id for the same path to the manifest bindingRootId", async () => {
    await service.upsertBindingRoot({
      id: "legacy-root-id",
      rootPath: "/Users/h/Letters",
      kind: "external",
      visibleAsWorkspace: false,
      selectedPaths: ["Letter.md"],
      consentedAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
    })
    await service.upsertBindingRoot({
      id: "manifest-root-id",
      rootPath: "/Users/h/Letters",
      kind: "external",
      visibleAsWorkspace: true,
      selectedPaths: ["Letter.md"],
      consentedAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
    })

    const roots = await service.getBindingRoots()
    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({
      id: "manifest-root-id",
      rootPath: "/Users/h/Letters",
      visibleAsWorkspace: true,
    })
  })
})
