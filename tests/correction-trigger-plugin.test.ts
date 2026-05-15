import { Schema } from "@tiptap/pm/model"
import { describe, expect, it } from "vitest"
import {
  collectCorrectionBlocks,
  collectCorrectionBlocksInRanges,
  getCurrentCorrectionBlock,
} from "@/lib/editor/correction-trigger-plugin"

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "text*",
      group: "block",
      toDOM: () => ["p", 0],
    },
    heading: {
      content: "text*",
      group: "block",
      toDOM: () => ["h1", 0],
    },
    bulletList: {
      content: "listItem+",
      group: "block",
      toDOM: () => ["ul", 0],
    },
    listItem: {
      content: "paragraph+",
      toDOM: () => ["li", 0],
    },
    codeBlock: {
      content: "text*",
      group: "block",
      code: true,
      toDOM: () => ["pre", ["code", 0]],
    },
    text: { group: "inline" },
  },
})

describe("correction trigger plugin helpers", () => {
  it("collects text-bearing editor blocks and skips code blocks", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", null, [schema.text("A headed block with enough words")]),
      schema.node("paragraph", null, [schema.text("A paragraph block with enough words to analyze")]),
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("A list item block with enough words to analyze")]),
        ]),
      ]),
      schema.node("codeBlock", null, [schema.text("const typo = 'do not analyze this block'")]),
    ])

    expect(collectCorrectionBlocks(doc).map((block) => block.nodeType)).toEqual([
      "heading",
      "paragraph",
      "listItem",
    ])
  })

  it("resolves affected ranges to their containing correction block", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("First paragraph with enough words to analyze")]),
      schema.node("paragraph", null, [schema.text("Second paragraph with a spelling errror inside")]),
    ])
    const second = collectCorrectionBlocks(doc)[1]

    expect(second).toBeDefined()
    expect(
      collectCorrectionBlocksInRanges(doc, [{ from: second!.pos + 8, to: second!.pos + 15 }]).map(
        (block) => block.id,
      ),
    ).toEqual([second!.id])
  })

  it("looks up a current block by its stable id", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("A paragraph block with enough words to analyze")]),
    ])
    const [block] = collectCorrectionBlocks(doc)

    expect(block).toBeDefined()
    expect(getCurrentCorrectionBlock(doc, block!.id)?.text).toBe(block!.text)
  })
})
