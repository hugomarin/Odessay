/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-478 follow-up — the saving spinner/error dot must step aside
 * on hover instead of overlapping the rename (pencil) button, which occupies
 * the same corner once the pointer arrives (reported from a screen recording:
 * the spinner sat visibly on top of the pencil icon).
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { EditorTabItem } from "@/components/editor/editor-tab-item"
import type { LocalEditorSessionTab } from "@/lib/local-db/schema"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function baseTab(overrides: Partial<LocalEditorSessionTab> = {}): LocalEditorSessionTab {
  return {
    id: "doc-a",
    writing_id: "doc-a",
    title: "Doc A",
    save_state: "saved",
    has_pending_sync: false,
    last_touched_at: 1,
    ...overrides,
  }
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("EditorTabItem — save-state indicator vs. rename button", () => {
  it("fades the saving spinner on hover, same as the left status glyph", () => {
    act(() => {
      root.render(
        <EditorTabItem
          tab={baseTab({ save_state: "saving" })}
          active={false}
          onSelect={() => {}}
          onClose={() => {}}
          onRename={() => {}}
        />,
      )
    })

    const spinner = container.querySelector(".animate-spin")
    expect(spinner).not.toBeNull()
    expect(spinner?.className).toContain("group-hover:opacity-0")
  })

  it("fades the error dot on hover for the same reason", () => {
    act(() => {
      root.render(
        <EditorTabItem
          tab={baseTab({ save_state: "error" })}
          active={false}
          onSelect={() => {}}
          onClose={() => {}}
          onRename={() => {}}
        />,
      )
    })

    const dot = container.querySelector(".bg-destructive")
    expect(dot).not.toBeNull()
    expect(dot?.className).toContain("group-hover:opacity-0")
  })
})
