import { afterEach, describe, expect, it } from "vitest"
import { isDesktopCatalogDualWriteEnabled } from "@/lib/services/desktop/catalog-feature-flag"

const originalValue = process.env.NEXT_PUBLIC_DESKTOP_CATALOG_DUAL_WRITE

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env.NEXT_PUBLIC_DESKTOP_CATALOG_DUAL_WRITE
    return
  }

  process.env.NEXT_PUBLIC_DESKTOP_CATALOG_DUAL_WRITE = originalValue
})

describe("desktop catalog feature flag", () => {
  it("enables the catalog by default for shipped M4 builds", () => {
    delete process.env.NEXT_PUBLIC_DESKTOP_CATALOG_DUAL_WRITE

    expect(isDesktopCatalogDualWriteEnabled()).toBe(true)
  })

  it("keeps an explicit false rollback switch", () => {
    process.env.NEXT_PUBLIC_DESKTOP_CATALOG_DUAL_WRITE = "false"

    expect(isDesktopCatalogDualWriteEnabled()).toBe(false)
  })

  it("accepts the documented explicit enabled value", () => {
    process.env.NEXT_PUBLIC_DESKTOP_CATALOG_DUAL_WRITE = "true"

    expect(isDesktopCatalogDualWriteEnabled()).toBe(true)
  })
})
