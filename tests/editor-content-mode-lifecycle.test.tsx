/**
 * @vitest-environment happy-dom
 */
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WritingEditorContent } from "@/components/editor/editor-content"
import type { Editor } from "@tiptap/react"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))

vi.mock("@tiptap/react", () => ({
  EditorContent: () => {
    useEffect(() => {
      lifecycle.mounts += 1
      return () => {
        lifecycle.unmounts += 1
      }
    }, [])
    return <div data-testid="tiptap-editor-content" />
  },
}))

describe("WritingEditorContent mode lifecycle", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    lifecycle.mounts = 0
    lifecycle.unmounts = 0
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const renderMode = async (mode: "rich" | "markdown") => {
    await act(async () => {
      root.render(
        <WritingEditorContent
          editor={{} as Editor}
          mode={mode}
          markdownValue={'<Card title="Card">\nBody\n</Card>'}
          onMarkdownChange={vi.fn()}
        />,
      )
    })
  }

  it("keeps the TipTap island mounted while Source mode is visible", async () => {
    await renderMode("rich")
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 })

    await renderMode("markdown")
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 })
    expect(container.querySelector(".EditorRichContent")?.getAttribute("aria-hidden")).toBe("true")
    expect(container.querySelector(".EditorRichContent")?.hasAttribute("inert")).toBe(true)

    await renderMode("rich")
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 })
    expect(container.querySelector(".EditorRichContent")?.hasAttribute("aria-hidden")).toBe(false)
    expect(container.querySelector(".EditorRichContent")?.hasAttribute("inert")).toBe(false)
  })
})
