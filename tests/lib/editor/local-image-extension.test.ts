/**
 * @vitest-environment happy-dom
 */
import { Editor } from "@tiptap/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEditorExtensions, getEditorMarkdown } from "@/lib/editor/extensions"
import { isLocalImageSource, type LocalImageBackupRequest } from "@/lib/editor/local-image-extension"

describe("local image extension", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("classifies filesystem references without treating online sources as local", () => {
    expect(isLocalImageSource("images/photo.png")).toBe(true)
    expect(isLocalImageSource("../shared/photo.png")).toBe(true)
    expect(isLocalImageSource("/Users/hugo/photo.png")).toBe(true)
    expect(isLocalImageSource("C:\\Users\\hugo\\photo.png")).toBe(true)
    expect(isLocalImageSource("https://example.com/photo.png")).toBe(false)
    expect(isLocalImageSource("/api/writing-assets/asset-1")).toBe(false)
    expect(isLocalImageSource("data:image/png;base64,abc")).toBe(false)
  })

  it("renders a local object URL while preserving the Markdown source", async () => {
    const element = document.createElement("div")
    document.body.append(element)
    const revoke = vi.fn()
    const resolveLocalImage = vi.fn(async () => ({ renderUrl: "blob:local-photo", revoke }))
    const editor = new Editor({
      element,
      extensions: createEditorExtensions({ resolveLocalImage }),
      content: "![Photo](/Users/hugo/photo.png)",
    })

    await vi.waitFor(() => expect(element.querySelector("img")?.getAttribute("src")).toBe("blob:local-photo"))
    expect(resolveLocalImage).toHaveBeenCalledWith("/Users/hugo/photo.png")
    expect(getEditorMarkdown(editor)).toContain("/Users/hugo/photo.png")

    editor.destroy()
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it("replaces the source only through the explicit backup request", async () => {
    const element = document.createElement("div")
    document.body.append(element)
    let request: LocalImageBackupRequest | null = null
    const editor = new Editor({
      element,
      extensions: createEditorExtensions({
        resolveLocalImage: async () => ({ renderUrl: "blob:local-photo" }),
        onRequestLocalImageBackup: (next) => { request = next },
      }),
      content: "![Photo](images/photo.png)",
    })

    const button = element.querySelector<HTMLButtonElement>("[aria-label='Back up image online']")
    expect(button).not.toBeNull()
    button!.click()
    expect(request).not.toBeNull()
    expect(getEditorMarkdown(editor)).toContain("images/photo.png")

    expect(request!.replaceSource("https://cdn.example.com/photo.png")).toBe(true)
    expect(getEditorMarkdown(editor)).toContain("https://cdn.example.com/photo.png")
    expect(getEditorMarkdown(editor)).not.toContain("images/photo.png")
    editor.destroy()
  })
})
