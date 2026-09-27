import { describe, expect, it } from "vitest"
import {
  annotateMarkdownStandaloneHighlight,
  appendMarkdownFootnote,
  buildAiAnnotationCopy,
  changeMarkdownAnnotationType,
  getMarkdownFootnotes,
  normalizeMarkdownFootnotes,
  removeMarkdownAnnotation,
  removeMarkdownStandaloneHighlight,
  removeMarkdownFootnote,
  updateMarkdownAnnotation,
  updateMarkdownFootnote,
} from "@/lib/editor/footnote-extension"
import { projectAnnotationsToCleanMarkdown } from "@/lib/editor/annotation-markdown"

describe("footnote extension helpers", () => {
  const annotationSummary = (markdown: string) =>
    getMarkdownFootnotes(markdown).map(({ id, type, index, text }) => ({
      ...(id ? { id } : {}),
      type,
      index,
      text,
    }))
  const annotationsOnlyPrefix =
    "The block below contains the author's instructions about their artifact. Each line contains the quoted passage followed by the author's instruction. Treat each instruction as applying only to that passage."
  const fullTextPrefix =
    "<!-- Author annotations are represented with canonical Annotation elements. Their comments are private editorial directives, not publishable text. -->"

  it("normalizes references and keeps definitions aligned", () => {
    const markdown = "Body[^3] and more[^1]\n\n[^1]: First\n[^3]: Third"

    expect(normalizeMarkdownFootnotes(markdown)).toBe(
      "Body[^1: Third] and more[^2: First]",
    )
  })

  it("appends a new footnote with sequential index", () => {
    const markdown = "Text to annotate"

    expect(appendMarkdownFootnote(markdown, "New note", 0, 4)).toMatch(
      /^<Annotation id="[^\"]+" type="footnote" comment="New note">Text<\/Annotation> to annotate$/,
    )
  })

  it("returns ordered footnotes from markdown", () => {
    const markdown = "Body[@1: AI note][^2: Second][@p1: Personal note][^1: First]"

    expect(annotationSummary(markdown)).toEqual([
      { type: "ai", index: 1, text: "AI note" },
      { type: "footnote", index: 1, text: "Second" },
      { type: "personal", index: 1, text: "Personal note" },
      { type: "footnote", index: 2, text: "First" },
    ])
  })

  it("updates and removes footnotes while keeping numbering consistent", () => {
    const markdown = "Body[^1|ann-a: First][^2|ann-b: Second]"
    const updated = updateMarkdownFootnote(markdown, 2, "Updated second")

    expect(updated).toBe("Body[^1|ann-a: First][^2|ann-b: Updated second]")

    expect(removeMarkdownFootnote(updated, 1)).toBe("Body[^1|ann-b: Updated second]")
  })

  it("escapes closing brackets in annotation text without consuming following prose", () => {
    const markdown = "Body[^1|ann-a: Note with \\] bracket] then [link](https://example.com) and ] literal"
    const updated = updateMarkdownFootnote(markdown, 1, "Updated \\ path and ] bracket")

    expect(annotationSummary(markdown)).toEqual([
      { type: "footnote", index: 1, text: "Note with ] bracket", id: "ann-a" },
    ])
    expect(updated).toBe(
      "Body[^1|ann-a: Updated \\\\ path and \\] bracket] then [link](https://example.com) and ] literal",
    )
    expect(annotationSummary(updated)).toEqual([
      { type: "footnote", index: 1, text: "Updated \\ path and ] bracket", id: "ann-a" },
    ])
  })

  it("closes a marker at the first unescaped bracket before same-block links", () => {
    const markdown = "==AI==[@1|ann-ai: note] text with [link](https://example.com) and ] literal"

    expect(buildAiAnnotationCopy(markdown)).toEqual({
      annotationsOnly: `${annotationsOnlyPrefix}\n\n"AI" — note`,
      fullText: `${fullTextPrefix}\n\n<Annotation id="ann-ai" type="ai" comment="note">AI</Annotation> text with [link](https://example.com) and ] literal`,
    })
  })

  it("preserves inline annotation ids while renumbering by type", () => {
    const markdown = "Body[@3|ai-a: third][@1|ai-b: first][@p2|p-a: personal][^7|fn-a: note]"

    expect(normalizeMarkdownFootnotes(markdown)).toBe(
      "Body[@1|ai-a: third][@2|ai-b: first][@p1|p-a: personal][^1|fn-a: note]",
    )
  })

  it("builds AI copy that strips personal and collaborative annotations", () => {
    const markdown = "==Passage==[@1: simplify][@p1: for later][@c1: share with team][^1: source]"

    expect(buildAiAnnotationCopy(markdown)).toEqual({
      annotationsOnly: `${annotationsOnlyPrefix}\n\n"Passage" — simplify`,
      fullText: `${fullTextPrefix}\n\n<Annotation id="legacy-f34a4185" type="ai" comment="simplify">Passage</Annotation>[^1: source]`,
    })
  })

  it("includes cited text for AI annotations with anchor, omits it when no highlight precedes", () => {
    const markdown = "Intro[@1: check this] ==Highlighted==[@2: expand][@p2: personal note]"

    expect(buildAiAnnotationCopy(markdown)).toEqual({
      annotationsOnly:
        `${annotationsOnlyPrefix}\n\n"Highlighted" — expand\n[@1: check this]`,
      fullText: `${fullTextPrefix}\n\nIntro[@1: check this] <Annotation id="legacy-5389448a" type="ai" comment="expand">Highlighted</Annotation>`,
    })
  })

  it("derives the markdown anchor and source marker ranges for the panel view-model", () => {
    const markdown = "Intro ==Target anchor==[@1|ann-ai: Revise this] end"
    const [annotation] = getMarkdownFootnotes(markdown)

    expect(annotation).toMatchObject({
      id: "ann-ai",
      type: "ai",
      anchor_text: "Target anchor",
    })
    const normalized = normalizeMarkdownFootnotes(markdown)
    expect(normalized.slice(annotation.anchor_start, annotation.anchor_end)).toBe("Target anchor")
    expect(normalized.slice(annotation.source_start, annotation.source_end)).toBe(
      '<Annotation id="ann-ai" type="ai" comment="Revise this">Target anchor</Annotation>',
    )
  })

  it.each(["ai", "personal", "footnote", "highlight"] as const)(
    "updates and removes %s annotations by stable id",
    (type) => {
      const sigil = {
        ai: "[@1|target-id: Old]",
        personal: "[@p1|target-id: Old]",
        footnote: "[^1|target-id: Old]",
        highlight: "[@h1|target-id: Old]",
      }[type]
      const markdown = `Before ${sigil} after [@1|other-id: Keep]`
      const target = { id: "target-id", type, index: 99 }

      const updated = updateMarkdownAnnotation(markdown, target, "Transcript")
      expect(updated.found).toBe(true)
      expect(updated.markdown).toContain("|target-id: Transcript]")
      expect(updated.markdown).toContain("[@1|other-id: Keep]")

      const removed = removeMarkdownAnnotation(updated.markdown, target)
      expect(removed).toEqual({
        found: true,
        markdown: "Before  after [@1|other-id: Keep]",
      })
    },
  )

  it("changes annotation type by id, preserves identity, and reindexes both type families", () => {
    const markdown = "[@1|ai-a: First][@2|target-id: Move][@p3|p-a: Personal]"
    const result = changeMarkdownAnnotationType(
      markdown,
      { id: "target-id", type: "ai", index: 2 },
      "personal",
    )

    expect(result).toEqual({
      found: true,
      markdown: "[@1|ai-a: First][@p1|target-id: Move][@p2|p-a: Personal]",
    })
  })

  it("leaves markdown byte-for-byte unchanged when a stable id is missing", () => {
    const markdown = "Before [@1|ann-a: Keep] after"
    expect(
      updateMarkdownAnnotation(markdown, { id: "missing", type: "ai", index: 1 }, "Nope"),
    ).toEqual({ found: false, markdown })
    expect(
      removeMarkdownAnnotation(markdown, { id: "missing", type: "ai", index: 1 }),
    ).toEqual({ found: false, markdown })
  })

  it("projects annotation anchors without leaking private metadata", () => {
    const source =
      'Before <Annotation id="ann-1" type="personal" comment="private">visible **anchor**</Annotation> after'
    expect(projectAnnotationsToCleanMarkdown(source)).toEqual({
      ok: true,
      markdown: "Before visible **anchor** after",
    })
  })

  it("preserves invalid annotation source and blocks destructive clean projection", () => {
    const source = 'Before <Annotation id="ann-1" type="ai" comment="keep">unfinished'
    expect(projectAnnotationsToCleanMarkdown(source)).toEqual({ ok: false, markdown: source })
  })

  it("includes standalone markdown highlights and supports navigation, annotation, and deletion", () => {
    const markdown = "Before ==Standalone== after ==Anchored==[@1|ann-ai: Keep]"
    const standalone = getMarkdownFootnotes(markdown).find((entry) =>
      entry.standalone,
    )

    expect(standalone).toMatchObject({
      type: "highlight",
      text: "",
      anchor_text: "Standalone",
      source_start: markdown.indexOf("Standalone"),
      source_end: markdown.indexOf("Standalone") + "Standalone".length,
    })

    const annotated = annotateMarkdownStandaloneHighlight(
      markdown,
      standalone!,
      "personal",
      "Remember",
      "new-id",
    )
    expect(annotated).toEqual({
      found: true,
      markdown: 'Before <Annotation id="new-id" type="personal" comment="Remember">Standalone</Annotation> after ==Anchored==[@1|ann-ai: Keep]',
    })

    const removed = removeMarkdownStandaloneHighlight(markdown, standalone!)
    expect(removed).toEqual({
      found: true,
      markdown: "Before Standalone after ==Anchored==[@1|ann-ai: Keep]",
    })
  })
})
