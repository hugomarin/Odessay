/**
 * @vitest-environment happy-dom
 */
import { Editor } from "@tiptap/core"
import { describe, expect, it } from "vitest"
import { collectPresentationImages } from "@/components/editor/image-presentation-viewer"
import { createEditorExtensions } from "@/lib/editor/extensions"

describe("image presentation collection", () => {
  it("keeps embedded images in document order and excludes other data", () => {
    const element = document.createElement("div")
    const editor = new Editor({
      element,
      extensions: createEditorExtensions(),
      content: "# Artifact\n\n![First](one.png)\n\nText\n\n![Second](two.svg)",
    })

    expect(collectPresentationImages(editor)).toEqual([
      { source: "one.png", alt: "First" },
      { source: "two.svg", alt: "Second" },
    ])
    editor.destroy()
  })
})
