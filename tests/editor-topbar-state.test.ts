import { describe, expect, it } from "vitest"
import type { Editor } from "@tiptap/react"
import { resolveStructureState } from "@/hooks/useEditorState"

type MockNode = {
  isTextblock: boolean
  type: { name: string }
  attrs?: { level?: number }
}

type EditorMockOptions = {
  empty: boolean
  active?: Partial<Record<"heading1" | "heading2" | "heading3" | "paragraph", boolean>>
  nodes?: MockNode[]
}

const createEditorMock = ({ empty, active = {}, nodes = [] }: EditorMockOptions): Editor =>
  ({
    state: {
      selection: { empty, from: 1, to: 4 },
      doc: {
        nodesBetween: (_from: number, _to: number, callback: (node: MockNode) => boolean) => {
          for (const node of nodes) {
            callback(node)
          }
        },
      },
    },
    isActive: (name: string, attrs?: Record<string, unknown>) => {
      if (name === "paragraph") {
        return Boolean(active.paragraph)
      }

      if (name === "heading") {
        const level = attrs?.level
        if (level === 1) return Boolean(active.heading1)
        if (level === 2) return Boolean(active.heading2)
        if (level === 3) return Boolean(active.heading3)
      }

      return false
    },
  }) as unknown as Editor

describe("resolveStructureState", () => {
  it("returns heading1 for empty selection on H1", () => {
    expect(resolveStructureState(createEditorMock({ empty: true, active: { heading1: true } }))).toBe("heading1")
  })

  it("returns heading2 for empty selection on H2", () => {
    expect(resolveStructureState(createEditorMock({ empty: true, active: { heading2: true } }))).toBe("heading2")
  })

  it("returns heading3 for empty selection on H3", () => {
    expect(resolveStructureState(createEditorMock({ empty: true, active: { heading3: true } }))).toBe("heading3")
  })

  it("returns paragraph for empty selection on paragraph", () => {
    expect(resolveStructureState(createEditorMock({ empty: true, active: { paragraph: true } }))).toBe("paragraph")
  })

  it("returns null for empty selection when no supported structure is active", () => {
    expect(resolveStructureState(createEditorMock({ empty: true }))).toBeNull()
  })

  it("returns paragraph for expanded selection across only paragraphs", () => {
    const nodes: MockNode[] = [{ isTextblock: true, type: { name: "paragraph" } }]
    expect(resolveStructureState(createEditorMock({ empty: false, nodes }))).toBe("paragraph")
  })

  it("returns heading2 for expanded selection across only H2 nodes", () => {
    const nodes: MockNode[] = [{ isTextblock: true, type: { name: "heading" }, attrs: { level: 2 } }]
    expect(resolveStructureState(createEditorMock({ empty: false, nodes }))).toBe("heading2")
  })

  it("returns null for mixed paragraph + heading selection", () => {
    const nodes: MockNode[] = [
      { isTextblock: true, type: { name: "paragraph" } },
      { isTextblock: true, type: { name: "heading" }, attrs: { level: 2 } },
    ]
    expect(resolveStructureState(createEditorMock({ empty: false, nodes }))).toBeNull()
  })

  it("returns null for unsupported heading levels", () => {
    const nodes: MockNode[] = [{ isTextblock: true, type: { name: "heading" }, attrs: { level: 4 } }]
    expect(resolveStructureState(createEditorMock({ empty: false, nodes }))).toBeNull()
  })

  it("returns null for non-structure textblocks", () => {
    const nodes: MockNode[] = [{ isTextblock: true, type: { name: "blockquote" } }]
    expect(resolveStructureState(createEditorMock({ empty: false, nodes }))).toBeNull()
  })

  it("ignores non-textblocks and returns null when no structure textblock is selected", () => {
    const nodes: MockNode[] = [{ isTextblock: false, type: { name: "table" } }]
    expect(resolveStructureState(createEditorMock({ empty: false, nodes }))).toBeNull()
  })
})

