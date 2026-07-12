import { describe, expect, it } from "vitest"
import { emitCatalogTitleChange, getLatestCatalogTitle } from "../lib/events/catalog-title-events"

describe("catalog title events", () => {
  it("retains the latest catalog title by stable writing UUID", () => {
    const writingId = crypto.randomUUID()

    emitCatalogTitleChange(new Map([[writingId, "Case4-renamed"]]))

    expect(getLatestCatalogTitle(writingId)).toBe("Case4-renamed")
  })
})
