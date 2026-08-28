/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NotesPanel } from "@/components/editor/panels/notes-panel"

let container: HTMLDivElement
let root: Root | null = null

const renderPanel = ({
  annotationId,
  type,
  onNavigate = vi.fn(() => true),
  onDeleteHighlight = vi.fn(() => true),
}: {
  annotationId: string
  type: "ai" | "highlight"
  onNavigate?: ReturnType<typeof vi.fn<() => boolean>>
  onDeleteHighlight?: ReturnType<typeof vi.fn<() => boolean>>
}) => {
  root = createRoot(container)
  act(() => {
    root?.render(
      <NotesPanel
        annotations={[
          {
          id: annotationId,
          standalone: annotationId.startsWith("highlight-"),
            type,
            index: 1,
            text: "",
            anchor_text: "Target anchor",
            anchor_start: 10,
            anchor_end: 23,
          },
        ]}
        currentMarkdown="==Target anchor=="
        onUpdateAnnotation={vi.fn(() => true)}
        onDeleteAnnotation={vi.fn(() => true)}
        onDeleteHighlight={onDeleteHighlight}
        onNavigate={onNavigate}
      />,
    )
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

describe("NotesPanel interactions", () => {
  it("shows feedback when a typed annotation anchor no longer exists", () => {
    const onNavigate = vi.fn(() => false)
    renderPanel({ annotationId: "annotation-1", type: "ai", onNavigate })

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Go to annotation in document"]',
    )
    act(() => button?.click())

    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "annotation-1", type: "ai", index: 1 }),
    )
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "The annotated text could not be found.",
    )
  })

  it("shows feedback when a standalone highlight cannot be deleted safely", () => {
    const onDeleteHighlight = vi.fn(() => false)
    renderPanel({ annotationId: "highlight-0", type: "highlight", onDeleteHighlight })

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Delete Highlight"]')
    act(() => button?.click())

    expect(onDeleteHighlight).toHaveBeenCalledWith("Target anchor", 10, 23, "highlight-0")
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "The annotated text could not be found.",
    )
  })
})
