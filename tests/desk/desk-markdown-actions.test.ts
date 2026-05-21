/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest"
import { copyTextWithFallback } from "@/lib/utils/clipboard"
import { downloadBlob } from "@/lib/utils/download"
import { buildMarkdownDownloadName, serializeWritingToMarkdown } from "@/lib/export/to-markdown"

describe("copyTextWithFallback", () => {
  it("returns true when clipboard API succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const result = await copyTextWithFallback("hello")
    expect(result).toBe(true)
    expect(writeText).toHaveBeenCalledWith("hello")
  })

  it("falls back to execCommand when clipboard API is missing", async () => {
    Object.assign(navigator, { clipboard: undefined })
    const execCommand = vi.spyOn(document, "execCommand").mockReturnValue(true)

    const result = await copyTextWithFallback("fallback text")
    expect(result).toBe(true)
    expect(execCommand).toHaveBeenCalledWith("copy")

    execCommand.mockRestore()
  })

  it("returns false when both clipboard and execCommand fail", async () => {
    Object.assign(navigator, { clipboard: undefined })
    const execCommand = vi.spyOn(document, "execCommand").mockReturnValue(false)

    const result = await copyTextWithFallback("fail text")
    expect(result).toBe(false)

    execCommand.mockRestore()
  })
})

describe("downloadBlob", () => {
  it("creates an anchor and triggers download", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:test")
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL

    const appendChildSpy = vi.spyOn(document.body, "appendChild")
    const removeChildSpy = vi.spyOn(document.body, "removeChild")

    downloadBlob(new Blob(["content"]), "test.md")

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(appendChildSpy).toHaveBeenCalledTimes(1)
    expect(removeChildSpy).toHaveBeenCalledTimes(1)

    // ObjectURL should be revoked after a delay, not immediately
    expect(revokeObjectURL).not.toHaveBeenCalled()

    appendChildSpy.mockRestore()
    removeChildSpy.mockRestore()
  })
})

describe("buildMarkdownDownloadName", () => {
  it("uses title when available", () => {
    const name = buildMarkdownDownloadName({ title: "My Essay", bodyText: "Body", writingId: "w1" })
    expect(name).toBe("my-essay.md")
  })

  it("falls back to body text slug when title is empty", () => {
    const name = buildMarkdownDownloadName({ title: "", bodyText: "Hello world", writingId: "w1" })
    expect(name).toBe("hello-world.md")
  })

  it("falls back to writingId when both title and body are empty", () => {
    const name = buildMarkdownDownloadName({ title: "", bodyText: "", writingId: "w1" })
    expect(name).toBe("w1.md")
  })
})

describe("serializeWritingToMarkdown", () => {
  it("serializes a simple doc to markdown", () => {
    const markdown = serializeWritingToMarkdown({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    })
    expect(markdown.trim()).toBe("Hello")
  })

  it("returns empty string for empty doc", () => {
    const markdown = serializeWritingToMarkdown({ type: "doc", content: [] })
    expect(markdown.trim()).toBe("")
  })
})
