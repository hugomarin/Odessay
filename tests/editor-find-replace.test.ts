import { Schema } from "@tiptap/pm/model"
import { describe, expect, it } from "vitest"
import {
  clampFindReplaceIndex,
  findDocumentMatches,
  findTextMatches,
  renderFindReplaceOverlayHtml,
  replaceAllMatchesInText,
  replaceMatchInText,
  resolveNextFindReplaceIndex,
} from "@/lib/editor/find-replace"

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "text*",
      group: "block",
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
})

describe("find/replace helpers", () => {
  it("finds literal matches with case sensitivity control", () => {
    expect(findTextMatches("Alpha alpha ALPHA", "alpha", false)).toHaveLength(3)
    expect(findTextMatches("Alpha alpha ALPHA", "alpha", true)).toHaveLength(1)
  })

  it("maps document matches to prose positions", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Alpha beta alpha")]),
      schema.node("paragraph", null, [schema.text("gamma alpha")]),
    ])

    expect(findDocumentMatches(doc, "alpha", false)).toEqual([
      { from: 1, to: 6, text: "Alpha" },
      { from: 12, to: 17, text: "alpha" },
      { from: 25, to: 30, text: "alpha" },
    ])
  })

  it("replaces one match in plain text", () => {
    const [firstMatch] = findTextMatches("alpha beta alpha", "alpha", false)
    expect(replaceMatchInText("alpha beta alpha", firstMatch, "omega")).toBe("omega beta alpha")
  })

  it("replaces all matches in plain text", () => {
    expect(replaceAllMatchesInText("alpha beta alpha", "alpha", "omega", false)).toEqual({
      value: "omega beta omega",
      replacements: 2,
    })
  })

  it("renders active and passive overlay matches", () => {
    const html = renderFindReplaceOverlayHtml("alpha beta alpha", "alpha", false, 1)
    expect(html).toContain('class="od-find-match od-find-match-active"')
    expect(html.match(/class="od-find-match"/g)).toHaveLength(1)
  })

  it("clamps and cycles match indexes safely", () => {
    expect(clampFindReplaceIndex(0, 4)).toBe(0)
    expect(clampFindReplaceIndex(3, 7)).toBe(2)
    expect(resolveNextFindReplaceIndex(3, 2, 1)).toBe(0)
    expect(resolveNextFindReplaceIndex(3, 0, -1)).toBe(2)
  })
})
