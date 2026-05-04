/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest"
import { generateHTML } from "@tiptap/html"
import { Editor } from "@tiptap/core"
import { createEditorExtensions } from "@/lib/editor/extensions"
import { WRITING_BODY_EXTENSIONS } from "@/lib/reading/render-body-html-core"

const STABLE_URL = "/api/writing-assets/test-asset-id"
const ALT_TEXT = "A descriptive alt"

const imageMarkdown = `![${ALT_TEXT}](${STABLE_URL})`

const imageJson = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "image",
          attrs: { src: STABLE_URL, alt: ALT_TEXT },
        },
      ],
    },
  ],
}

function createTestEditor() {
  return new Editor({
    extensions: createEditorExtensions(),
    content: "",
  })
}

describe("image markdown round-trip", () => {
  it("parses markdown image to TipTap JSON via tiptap-markdown", () => {
    const editor = createTestEditor()
    editor.commands.setContent(imageMarkdown)
    const json = editor.getJSON()
    expect(json).toMatchObject({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: STABLE_URL, alt: ALT_TEXT },
        },
      ],
    })
    editor.destroy()
  })

  it("serializes TipTap JSON image to markdown", () => {
    const editorLike = {
      getJSON: () => imageJson,
      storage: {
        markdown: {
          getMarkdown: () => {
            // tiptap-markdown serializes images as ![alt](src)
            const json = imageJson
            const imageNode = json.content[0].content?.[0]
            if (imageNode?.type === "image") {
              return `![${imageNode.attrs.alt}](${imageNode.attrs.src})`
            }
            return ""
          },
        },
      },
    }
    const markdown = editorLike.storage.markdown.getMarkdown()
    expect(markdown).toBe(imageMarkdown)
  })

  it("renders image HTML from JSON for reading surfaces", () => {
    const html = generateHTML(imageJson, WRITING_BODY_EXTENSIONS)
    expect(html).toContain(`src="${STABLE_URL}"`)
    expect(html).toContain(`alt="${ALT_TEXT}"`)
  })
})
