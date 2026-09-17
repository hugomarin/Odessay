/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { Editor, type Content } from "@tiptap/core"
import { createEditorExtensions, getEditorMarkdown } from "@/lib/editor/extensions"

const createEditor = (content: Content = "") =>
  new Editor({
    extensions: createEditorExtensions(),
    content,
  })

describe("controlled document component blocks", () => {
  it.each([
    ["Tip", "tip"],
    ["Info", "info"],
    ["Card", "card"],
  ] as const)("parses and serializes %s through the canonical editor adapter", (kind, nodeName) => {
    const title = kind === "Card" ? "Read next" : `${kind} title`
    const extra = kind === "Card" ? ' icon="book" href="https://example.com"' : ""
    const markdown = `<${kind} title="${title}"${extra}>\nA **nested** paragraph.\n</${kind}>`
    const editor = createEditor()

    editor.commands.setContent(markdown)

    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        {
          type: nodeName,
          attrs: expect.objectContaining({ title }),
          content: [
            {
              type: "paragraph",
              content: expect.arrayContaining([{ type: "text", text: "A " }]),
            },
          ],
        },
      ],
    })
    expect(getEditorMarkdown(editor)).toBe(markdown)
    editor.destroy()
  })

  it("inserts empty blocks with a caret in editable content", () => {
    const editor = createEditor()

    expect(editor.commands.insertTip({ title: "Remember" })).toBe(true)
    const json = editor.getJSON()
    expect(json.content?.[0]).toMatchObject({
      type: "tip",
      attrs: { title: "Remember" },
      content: [{ type: "paragraph" }],
    })
    expect(editor.state.selection.$from.node(-1).type.name).toBe("tip")
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph")
    editor.destroy()
  })

  it("edits titles and Card properties without leaving the document surface", () => {
    const editor = createEditor()
    editor.commands.insertTip()
    const tipTitle = editor.view.dom.querySelector<HTMLInputElement>('[aria-label="Tip title"]')
    expect(tipTitle).not.toBeNull()
    if (!tipTitle) return
    tipTitle.value = "A useful tip"
    tipTitle.dispatchEvent(new Event("input", { bubbles: true }))
    expect(editor.getJSON().content?.[0].attrs?.title).toBe("A useful tip")

    editor.commands.setContent({
      type: "doc",
      content: [{ type: "card", attrs: { title: "Card" }, content: [{ type: "paragraph" }] }],
    })
    const settings = editor.view.dom.querySelector<HTMLButtonElement>('[aria-label="Edit card properties"]')
    expect(settings).not.toBeNull()
    settings?.click()
    expect(settings?.getAttribute("aria-expanded")).toBe("true")
    const icon = editor.view.dom.querySelector<HTMLInputElement>('[aria-label="Card icon"]')
    const href = editor.view.dom.querySelector<HTMLInputElement>('[aria-label="Card link"]')
    if (!icon || !href) return
    icon.value = "book"
    href.value = "https://example.com"
    href.dispatchEvent(new Event("change", { bubbles: true }))
    expect(editor.getJSON().content?.[0].attrs).toMatchObject({
      title: "Card",
      icon: "book",
      href: "https://example.com",
    })
    href.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(settings?.getAttribute("aria-expanded")).toBe("false")
    editor.destroy()
  })

  it("converts selected blocks to a Card in one undoable transaction", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Alpha" }] },
        { type: "paragraph", content: [{ type: "text", text: "Beta" }] },
      ],
    })
    const before = editor.getJSON()
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })

    expect(editor.commands.convertSelectionToCard({ title: "Summary", icon: "sparkles" })).toBe(true)
    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          type: "card",
          attrs: { title: "Summary", icon: "sparkles", href: "" },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Alpha" }] },
            { type: "paragraph", content: [{ type: "text", text: "Beta" }] },
          ],
        },
      ],
    })

    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    editor.destroy()
  })

  it("rejects invalid Card attributes and invalid nested insertion without mutation", () => {
    const editor = createEditor()
    expect(editor.commands.insertCard({ href: "javascript:alert(1)" })).toBe(false)
    expect(editor.getJSON()).toEqual({ type: "doc", content: [{ type: "paragraph" }] })

    editor.commands.insertTip()
    const before = editor.getJSON()
    expect(editor.commands.insertCard()).toBe(false)
    expect(editor.getJSON()).toEqual(before)
    editor.destroy()
  })

  it("rejects controlled blocks in unsupported parents without mutation", () => {
    for (const content of [
      {
        type: "doc",
        content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quote" }] }] }],
      },
      {
        type: "doc",
        content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }] }] }] }],
      },
    ] satisfies Content[]) {
      const editor = createEditor(content)
      editor.commands.setTextSelection(2)
      const before = editor.getJSON()

      expect(editor.commands.insertTip()).toBe(false)
      expect(editor.getJSON()).toEqual(before)
      editor.destroy()
    }
  })

  it("does not wrap an existing controlled block in a Card", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Alpha" }] },
        { type: "tip", attrs: { title: "Remember" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Inside" }] }] },
      ],
    })
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
    const before = editor.getJSON()

    expect(editor.commands.convertSelectionToCard()).toBe(false)
    expect(editor.getJSON()).toEqual(before)
    editor.destroy()
  })

  it("keeps fenced code literal and preserves unsupported language strings", () => {
    const markdown = "```custom-runtime\n<Tip title=\"literal\">\nnot a component\n</Tip>\n```"
    const editor = createEditor()

    editor.commands.setContent(markdown)

    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          type: "codeBlock",
          attrs: { language: "custom-runtime" },
          content: [{ type: "text", text: '<Tip title="literal">\nnot a component\n</Tip>' }],
        },
      ],
    })
    expect(getEditorMarkdown(editor)).toBe(markdown)
    editor.destroy()
  })

  it("does not mistake a component closing tag inside a nested fence for the block boundary", () => {
    const markdown = '<Tip title="Literal example">\n```md\n</Tip>\n```\nAfter the fence.\n</Tip>'
    const editor = createEditor()

    editor.commands.setContent(markdown)

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "tip",
      content: [
        { type: "codeBlock", content: [{ type: "text", text: "</Tip>" }] },
        { type: "paragraph", content: [{ type: "text", text: "After the fence." }] },
      ],
    })
    const canonical = '<Tip title="Literal example">\n```md\n</Tip>\n```\n\nAfter the fence.\n</Tip>'
    expect(getEditorMarkdown(editor)).toBe(canonical)
    editor.commands.setContent(canonical)
    expect(getEditorMarkdown(editor)).toBe(canonical)
    editor.destroy()
  })

  it.each([10, 100, 1000])("opens a component with %i literal closing tags in one pass", (count) => {
    const literalClosings = Array.from({ length: count }, () => "</Tip>").join("\n")
    const markdown = `<Tip title="Stress">\n\`\`\`md\n${literalClosings}\n\`\`\`\nAfter the fence.\n</Tip>`
    const editor = createEditor()

    editor.commands.setContent(markdown)

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "tip",
      content: [
        { type: "codeBlock", content: [{ type: "text", text: literalClosings }] },
        { type: "paragraph", content: [{ type: "text", text: "After the fence." }] },
      ],
    })
    editor.destroy()
  })

  it("does not parse or serialize the full document during typing transactions", () => {
    const editor = createEditor("Start")
    const markdownStorage = (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown
    const getMarkdown = vi.spyOn(markdownStorage, "getMarkdown")

    for (let index = 0; index < 100; index += 1) {
      editor.commands.insertContent("x")
    }

    expect(getMarkdown).not.toHaveBeenCalled()
    expect(editor.getText()).toHaveLength(105)
    editor.destroy()
  })

  it("keeps UI invocation behind typed commands instead of source or persistence mutation", () => {
    const toolbar = readFileSync("components/editor/editor-format-toolbar.tsx", "utf8")
    const shell = readFileSync("components/editor/editor-shell.tsx", "utf8")

    expect(toolbar).not.toMatch(/<(?:Tip|Info|Card)(?:\s|>)/)
    expect(shell).toContain("insertTip().run()")
    expect(shell).toContain("insertInfo().run()")
    expect(shell).toContain("convertSelectionToCard().run()")
    expect(shell).toContain("Those blocks cannot be placed in a Card.")
    expect(shell).toContain("chain.insertCard().run()")
    expect(shell).not.toMatch(/case \"(?:tipBlock|infoBlock|cardBlock)\"[\s\S]{0,500}persistEditorSnapshot/)
  })
})
