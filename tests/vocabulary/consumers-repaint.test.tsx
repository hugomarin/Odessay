/**
 * @vitest-environment happy-dom
 *
 * ODE-476: proves the "repaint every consumer from the shared catalog"
 * contract at the boundary that matters — real components subscribed via
 * `useVocabulary()`, not just the pure resolve helpers (already covered by
 * `tests/vocabulary/resolve.test.ts`).
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WritingStatusBadge } from "@/components/ui/writing-status-badge"
import { orderGroupKeysByCatalog, listVisibleVocabulary, getVocabularyLabel } from "@/lib/vocabulary/resolve"
import { getVocabularyCatalogSnapshot, resetVocabularyCatalogForTest, setVocabularyCatalog } from "@/lib/vocabulary/catalog"
import type { VocabularyItem } from "@/lib/vocabulary/types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function item(overrides: Partial<VocabularyItem> & Pick<VocabularyItem, "kind" | "key">): VocabularyItem {
  return {
    id: `${overrides.kind}:${overrides.key}`,
    name: overrides.key,
    description: "",
    icon: "circle-dashed",
    color: "#5B5BD6",
    hidden: false,
    isBase: false,
    isRequired: false,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

beforeEach(() => {
  resetVocabularyCatalogForTest()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  resetVocabularyCatalogForTest()
})

describe("consumers repaint from the shared catalog (ODE-476)", () => {
  it("a rename updates a mounted consumer without remounting or reloading", async () => {
    setVocabularyCatalog([item({ kind: "status", key: "draft", name: "Draft" })])

    await act(async () => {
      root.render(<WritingStatusBadge status="draft" />)
    })
    expect(container.textContent).toContain("Draft")

    act(() => {
      setVocabularyCatalog([item({ kind: "status", key: "draft", name: "In progress" })])
    })

    expect(container.textContent).not.toContain("Draft")
    expect(container.textContent).toContain("In progress")
  })

  it("a hidden status disappears from option lists but still renders on an artifact that carries it", async () => {
    setVocabularyCatalog([
      item({ kind: "status", key: "draft", name: "Draft", position: 0 }),
      item({ kind: "status", key: "archived", name: "Archived", position: 1, hidden: true }),
    ])

    const options = listVisibleVocabulary(getVocabularyCatalogSnapshot(), "status")
    expect(options.map((option) => option.key)).toEqual(["draft"])

    await act(async () => {
      root.render(<WritingStatusBadge status="archived" />)
    })
    expect(container.textContent).toContain("Archived")
  })

  it("an unknown value renders with a defined, non-crashing presentation", async () => {
    setVocabularyCatalog([item({ kind: "status", key: "draft", name: "Draft" })])

    await act(async () => {
      root.render(<WritingStatusBadge status="deleted-custom-status" />)
    })
    // Falls back to the raw key — never blank, never "undefined", never a crash.
    expect(container.textContent).toContain("deleted-custom-status")
  })

  it("filter/group state keyed by the vocabulary key survives a rename — only the label changes", () => {
    const before = [item({ kind: "status", key: "draft", name: "Draft" })]
    const after = [item({ kind: "status", key: "draft", name: "In progress" })]

    // A filter or group-by stores `key`, never the label, so it keeps
    // resolving to the same bucket across a rename.
    expect(getVocabularyLabel(before, "status", "draft")).toBe("Draft")
    expect(getVocabularyLabel(after, "status", "draft")).toBe("In progress")
  })
})

describe("orderGroupKeysByCatalog (ODE-476)", () => {
  const catalog = [
    item({ kind: "status", key: "b", name: "B", position: 2 }),
    item({ kind: "status", key: "a", name: "A", position: 1 }),
    item({ kind: "status", key: "hidden-but-in-use", name: "Hidden", position: 0, hidden: true }),
  ]

  it("orders known keys by catalog position, hidden items included", () => {
    const ordered = orderGroupKeysByCatalog(catalog, "status", ["b", "a", "hidden-but-in-use"])
    expect(ordered).toEqual(["hidden-but-in-use", "a", "b"])
  })

  it("appends keys the catalog no longer has, sorted, after the known ones", () => {
    const ordered = orderGroupKeysByCatalog(catalog, "status", ["b", "zeta-deleted", "a", "alpha-deleted"])
    expect(ordered).toEqual(["a", "b", "alpha-deleted", "zeta-deleted"])
  })

  it("never resolves a key against the wrong kind's catalog entry", () => {
    const mixedCatalog = [...catalog, item({ kind: "type", key: "draft", name: "A type", position: 0 })]
    // "draft" only exists as a *type* here — for a status group-by it must be
    // treated as unknown (appended, not ordered by the type's position).
    const ordered = orderGroupKeysByCatalog(mixedCatalog, "status", ["b", "draft", "a"])
    expect(ordered).toEqual(["a", "b", "draft"])
  })
})
