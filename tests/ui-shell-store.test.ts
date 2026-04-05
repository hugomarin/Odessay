import { beforeEach, describe, expect, it, vi } from "vitest"

const COOKIE_KEY = "odessay-sidebar-mode"

type CookieDocument = {
  cookie: string
}

const createCookieDocument = (): CookieDocument => {
  const cookieMap = new Map<string, string>()
  return {
    get cookie() {
      return Array.from(cookieMap.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join("; ")
    },
    set cookie(rawValue) {
      const [pair] = rawValue.split(";")
      const separatorIndex = pair.indexOf("=")
      if (separatorIndex <= 0) {
        return
      }

      const key = pair.slice(0, separatorIndex).trim()
      const value = pair.slice(separatorIndex + 1).trim()
      cookieMap.set(key, value)
    },
  }
}

beforeEach(() => {
  vi.resetModules()
  const document = createCookieDocument()

  vi.stubGlobal("document", document)
})

describe("ui-shell-store", () => {
  it("preserves collapsed preference after opening and closing collections panel", async () => {
    const store = await import("../lib/stores/ui-shell-store")

    store.initializeUiShellStore()
    store.setSidebarMode("collapsed")
    store.setSidebarPanel("collections")
    store.setSidebarPanel(null)

    expect(document.cookie).toContain(`${COOKIE_KEY}=collapsed`)
  })

  it("preserves expanded preference when collections panel is toggled off", async () => {
    const store = await import("../lib/stores/ui-shell-store")

    store.initializeUiShellStore()
    store.setSidebarMode("expanded")
    store.setSidebarPanel("collections")
    store.setSidebarPanel(null)

    expect(document.cookie).toContain(`${COOKIE_KEY}=expanded`)
  })
})
