import { beforeEach, describe, expect, it, vi } from "vitest"

type MemoryStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

const STORAGE_KEY = "odessay-ui-shell"

const createMemoryStorage = (): MemoryStorage => {
  const store = new Map<string, string>()

  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: (key) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

beforeEach(() => {
  vi.resetModules()
  const sessionStorage = createMemoryStorage()

  vi.stubGlobal("window", {
    sessionStorage,
  })
})

describe("ui-shell-store", () => {
  it("preserves collapsed preference after opening and closing collections panel", async () => {
    const store = await import("../lib/stores/ui-shell-store")

    store.initializeUiShellStore()
    store.setSidebarMode("collapsed")
    store.setSidebarPanel("collections")
    store.setSidebarPanel(null)

    const persisted = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "{}")

    expect(persisted.sidebarMode).toBe("collapsed")
    expect(persisted.panel).toBeNull()
  })

  it("preserves expanded preference when collections panel is toggled off", async () => {
    const store = await import("../lib/stores/ui-shell-store")

    store.initializeUiShellStore()
    store.setSidebarMode("expanded")
    store.setSidebarPanel("collections")
    store.setSidebarPanel(null)

    const persisted = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "{}")

    expect(persisted.sidebarMode).toBe("expanded")
    expect(persisted.panel).toBeNull()
  })
})
