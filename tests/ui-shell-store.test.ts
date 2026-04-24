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
  it("persists collapsed preference", async () => {
    const store = await import("../lib/stores/ui-shell-store")

    store.initializeUiShellStore()
    store.setSidebarMode("collapsed")

    expect(document.cookie).toContain(`${COOKIE_KEY}=collapsed`)
  })

  it("toggles between expanded and collapsed", async () => {
    const store = await import("../lib/stores/ui-shell-store")

    store.initializeUiShellStore()
    store.setSidebarMode("expanded")
    store.toggleSidebarMode()

    expect(document.cookie).toContain(`${COOKIE_KEY}=collapsed`)
  })
})
