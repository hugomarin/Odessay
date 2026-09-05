import { beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"

const mockSettingsStore = new Map<string, unknown>()

const { tauriCatalogListMock, tauriCatalogBulkDualWriteMock } = vi.hoisted(() => ({
  tauriCatalogListMock: vi.fn(async (_dbPath: string, _query?: unknown) => [] as unknown[]),
  tauriCatalogBulkDualWriteMock: vi.fn(async (_dbPath: string, _inputs: unknown[]) => [] as string[]),
}))

vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}))

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriSettingsRead: vi.fn(async (_configDir: string, key: string) => {
    return mockSettingsStore.get(key) ?? null
  }),
  tauriSettingsWrite: vi.fn(async (_configDir: string, key: string, value: unknown) => {
    mockSettingsStore.set(key, value)
  }),
  tauriSettingsDelete: vi.fn(async (_configDir: string, key: string) => {
    mockSettingsStore.delete(key)
  }),
  tauriSettingsListKeys: vi.fn(async (_configDir: string) => {
    return Array.from(mockSettingsStore.keys())
  }),
  tauriCatalogList: tauriCatalogListMock,
  tauriCatalogBulkDualWrite: tauriCatalogBulkDualWriteMock,
}))

describe("DesktopSettingsService", () => {
  let service: DesktopSettingsService

  beforeEach(() => {
    mockSettingsStore.clear()
    service = new DesktopSettingsService("/tmp/odessay-config")
    tauriCatalogListMock.mockReset().mockResolvedValue([])
    tauriCatalogBulkDualWriteMock.mockReset().mockResolvedValue([])
  })

  it("getUserSettings returns default settings when store is empty", async () => {
    const result = await service.getUserSettings()
    expect(result.error).toBeNull()
    expect(result.data?.disabledStatuses).toEqual([])
    // 6 base types + 7 base statuses, unmaterialized — requirement 3.
    expect(result.data?.vocabulary).toHaveLength(13)
    expect(result.data?.vocabulary.every((item) => item.isBase)).toBe(true)
  })

  it("updateUserSettings persists disabledStatuses", async () => {
    const update = await service.updateUserSettings({ disabledStatuses: ["archived"] })
    expect(update.error).toBeNull()
    expect(update.data?.disabledStatuses).toEqual(["archived"])

    const read = await service.getUserSettings()
    expect(read.data?.disabledStatuses).toEqual(["archived"])
  })

  describe("vocabulary (ODE-473)", () => {
    it("listVocabulary returns exactly the base items with no data written (requirement 3)", async () => {
      const result = await service.listVocabulary()
      expect(result.error).toBeNull()
      expect(result.data).toHaveLength(13)
    })

    it("creates a custom item and it survives a fresh listVocabulary call", async () => {
      const created = await service.createVocabularyItem({
        kind: "type",
        name: "Research",
        icon: "compass",
        color: "#5B5BD6",
      })
      expect(created.error).toBeNull()
      expect(created.data?.key).toBe("research")
      expect(created.data?.isBase).toBe(false)

      const list = await service.listVocabulary()
      expect(list.data).toHaveLength(14)
      expect(list.data?.some((item) => item.key === "research")).toBe(true)
    })

    it("rejects an icon outside the closed set for the kind", async () => {
      const result = await service.createVocabularyItem({
        kind: "status",
        name: "Blocked",
        icon: "bot", // type-only icon
        color: "#5B5BD6",
      })
      expect(result.error?.code).toBe("INVALID_INPUT")
    })

    it("rejects deleting a base item, even unmaterialized", async () => {
      const result = await service.deleteVocabularyItem("base:type:general")
      expect(result.error?.code).toBe("INVALID_INPUT")
      expect(result.error?.message).toContain("base item")
      expect(tauriCatalogBulkDualWriteMock).not.toHaveBeenCalled()
    })

    it("rejects hiding draft", async () => {
      const result = await service.updateVocabularyItem("base:status:draft", { hidden: true })
      expect(result.error?.code).toBe("INVALID_INPUT")
    })

    it("allows renaming a base item without materializing a full custom copy that can be deleted", async () => {
      const result = await service.updateVocabularyItem("base:type:general", { name: "Default" })
      expect(result.error).toBeNull()
      expect(result.data?.name).toBe("Default")
      expect(result.data?.isBase).toBe(true)

      // The base item is still protected from deletion once materialized.
      const del = await service.deleteVocabularyItem(result.data!.id)
      expect(del.error?.code).toBe("INVALID_INPUT")
    })

    it("deleting a custom item rewrites matching catalog documents to the base value and returns the count", async () => {
      const created = await service.createVocabularyItem({
        kind: "status",
        name: "Blocked",
        icon: "flame",
        color: "#96532C",
      })
      const key = created.data!.key

      tauriCatalogListMock.mockResolvedValue([
        {
          id: "doc-1", localPresent: true, cloudPresent: true, cloudAccountId: "user-1",
          syncStatus: "synced", title: "Doc 1", slug: "doc-1", status: key, artifactType: "general",
          visibility: "private", version: 3, deletedAt: null, createdAt: 1, modifiedAt: 2,
          bindingRootId: null, relativePath: null, canonicalPath: null, inode: null,
          contentHash: null, size: null, lastSeenAt: null, excerpt: null, excerptContentHash: null,
        },
        {
          id: "doc-2", localPresent: true, cloudPresent: false, cloudAccountId: null,
          syncStatus: "pending", title: "Doc 2", slug: "doc-2", status: "draft", artifactType: "general",
          visibility: "private", version: 1, deletedAt: null, createdAt: 1, modifiedAt: 2,
          bindingRootId: null, relativePath: null, canonicalPath: null, inode: null,
          contentHash: null, size: null, lastSeenAt: null, excerpt: null, excerptContentHash: null,
        },
      ])

      const result = await service.deleteVocabularyItem(created.data!.id)
      expect(result.error).toBeNull()
      expect(result.data).toEqual({ rewrittenCount: 1 })

      expect(tauriCatalogBulkDualWriteMock).toHaveBeenCalledTimes(1)
      const [, inputs] = tauriCatalogBulkDualWriteMock.mock.calls[0]!
      expect(inputs).toHaveLength(1)
      const [firstInput] = inputs as Array<{
        document: { id: string; status: string | null }
        mutation: { operation: string; payloadJson: string } | null
      }>
      expect(firstInput.document.id).toBe("doc-1")
      expect(firstInput.document.status).toBe("draft")
      expect(firstInput.mutation).not.toBeNull()
      expect(firstInput.mutation!.operation).toBe("upsert")
      const payload = JSON.parse(firstInput.mutation!.payloadJson)
      expect(payload.mutationKind).toBe("metadata")
      expect(payload.status).toBe("draft")

      const list = await service.listVocabulary()
      expect(list.data?.some((item) => item.key === key)).toBe(false)
    })

    it("deleting an item nobody used rewrites nothing and returns count 0", async () => {
      const created = await service.createVocabularyItem({
        kind: "type",
        name: "Unused",
        icon: "compass",
        color: "#2E7D4F",
      })
      tauriCatalogListMock.mockResolvedValue([])

      const result = await service.deleteVocabularyItem(created.data!.id)
      expect(result.error).toBeNull()
      expect(result.data).toEqual({ rewrittenCount: 0 })
      expect(tauriCatalogBulkDualWriteMock).not.toHaveBeenCalled()
    })
  })

  it("getDesktopSettings returns full settings object", async () => {
    await service.updateDesktopSettings({ writingsDir: "/home/user/docs", editorFontSize: 16 })

    const result = await service.getDesktopSettings()
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      writingsDir: "/home/user/docs",
      editorFontSize: 16,
      disabledStatuses: [],
    })
  })

  it("updateDesktopSettings merges partial updates", async () => {
    await service.updateDesktopSettings({ writingsDir: "/home/user/docs" })
    await service.updateDesktopSettings({ editorFontSize: 18 })

    const result = await service.getDesktopSettings()
    expect(result.data).toMatchObject({
      writingsDir: "/home/user/docs",
      editorFontSize: 18,
    })
  })

  it("clearAllSettings removes all settings", async () => {
    await service.updateDesktopSettings({ writingsDir: "/home/user/docs" })
    const clear = await service.clearAllSettings()
    expect(clear.error).toBeNull()

    const result = await service.getDesktopSettings()
    expect(result.data).toEqual({ disabledStatuses: [] })
  })
})
