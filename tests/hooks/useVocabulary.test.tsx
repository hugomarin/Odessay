/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useVocabulary } from "@/hooks/useVocabulary"
import { resetVocabularyCatalogForTest, setVocabularyCatalog } from "@/lib/vocabulary/catalog"
import type { VocabularyItem } from "@/lib/vocabulary/types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let renderCount = 0

function Probe() {
  renderCount += 1
  const catalog = useVocabulary()
  return <span data-testid="count">{catalog.length}</span>
}

function customItem(id: string): VocabularyItem {
  return {
    id,
    kind: "type",
    key: id,
    name: id,
    description: "",
    icon: "compass",
    color: "#5B5BD6",
    hidden: false,
    isBase: false,
    isRequired: false,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

beforeEach(() => {
  resetVocabularyCatalogForTest()
  renderCount = 0
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  resetVocabularyCatalogForTest()
})

describe("useVocabulary", () => {
  it("returns the current catalog and defaults to base items", async () => {
    await act(async () => {
      root.render(<Probe />)
    })
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("13")
  })

  it("repaints on a catalog change without a reload — one re-render for the whole batch (requirement 9/10)", async () => {
    await act(async () => {
      root.render(<Probe />)
    })
    const rendersBeforeUpdate = renderCount

    await act(async () => {
      setVocabularyCatalog([customItem("a"), customItem("b"), customItem("c")])
    })

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("3")
    // One update touching 3 items causes exactly one additional render, not 3.
    expect(renderCount).toBe(rendersBeforeUpdate + 1)
  })
})
