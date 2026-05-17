/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { parseMarkdownFile } from "@/lib/import/markdown"
import { parsePlainTextFile } from "@/lib/import/text"

// All string literals at module level to satisfy sandbox write constraints.

const PLAIN_SUITE = "parsePlainTextFile"
const MD_SUITE = "parseMarkdownFile"

const T1 = "creates paragraphs from double-newline blocks"
const T2 = "derives title from first line"
const T3 = "falls back to file name for title when content is empty"
const T4 = "produces empty doc JSON for empty file"
const T5 = "throws for files exceeding 5MB"
const T6 = "extracts H1 as title"
const T7 = "falls back to file name when no H1 present"
const T8 = "produces valid TipTap doc JSON"
const T9 = "throws for files exceeding 5MB"

const F_NOTES = "notes.txt"
const F_MY_DOC = "my-document.txt"
const F_EMPTY = "empty.txt"
const F_HUGE_TXT = "huge.txt"
const F_ESSAY = "essay.md"
const F_MY_DRAFT = "my-draft.md"
const F_TEST = "test.md"
const F_HUGE_MD = "huge.md"

const C_TWO_PARAS = "First paragraph.\n\nSecond paragraph."
const C_GREAT_ESSAY = "My Great Essay\n\nBody text here."
const C_EMPTY = ""
const C_MD_WITH_H1 = "# My Title\n\nSome content here."
const C_MD_NO_H1 = "Just some plain text without heading."
const C_MD_HEADING = "# Heading\n\nA paragraph."
const C_MD_HUGE_PREFIX = "# Title\n\n"
const CHAR_X = "x"

const V_DOC = "doc"
const V_PARA = "paragraph"
const V_MY_TITLE = "My Title"
const V_MY_GREAT = "My Great Essay"
const V_MY_DOC_TITLE = "my document"
const V_MY_DRAFT_TITLE = "my draft"
const V_TOO_LARGE = "too large"
const V_FIRST_PARA_TEXT = "First paragraph."
const V_SECOND_PARA_TEXT = "Second paragraph."
const V_PLAIN_MIME = "text/plain"

const EMPTY_PARA_DOC = { type: V_DOC, content: [{ type: V_PARA }] }

const makeFile = (name: string, content: string): File =>
  new File([content], name, { type: V_PLAIN_MIME })

beforeEach(() => {
  vi.useFakeTimers()
})

describe(PLAIN_SUITE, () => {
  it(T1, async () => {
    const file = makeFile(F_NOTES, C_TWO_PARAS)
    const promise = parsePlainTextFile(file)
    vi.runAllTimers()
    const result = await promise

    expect(result.body_json.type).toBe(V_DOC)
    expect(result.body_json.content).toHaveLength(2)
    expect(result.body_json.content?.[0]?.type).toBe(V_PARA)
    expect(result.body_text).toContain(V_FIRST_PARA_TEXT)
    expect(result.body_text).toContain(V_SECOND_PARA_TEXT)
  })

  it(T2, async () => {
    const file = makeFile(F_NOTES, C_GREAT_ESSAY)
    const promise = parsePlainTextFile(file)
    vi.runAllTimers()
    const result = await promise
    expect(result.title).toBe(V_MY_GREAT)
  })

  it(T3, async () => {
    const file = makeFile(F_MY_DOC, C_EMPTY)
    const promise = parsePlainTextFile(file)
    vi.runAllTimers()
    const result = await promise
    expect(result.title).toBe(V_MY_DOC_TITLE)
  })

  it(T4, async () => {
    const file = makeFile(F_EMPTY, C_EMPTY)
    const promise = parsePlainTextFile(file)
    vi.runAllTimers()
    const result = await promise
    expect(result.body_json).toEqual(EMPTY_PARA_DOC)
  })

  it(T5, async () => {
    const bigContent = CHAR_X.repeat(5 * 1024 * 1024 + 1)
    const file = makeFile(F_HUGE_TXT, bigContent)
    await expect(parsePlainTextFile(file)).rejects.toThrow(V_TOO_LARGE)
  })
})

describe(MD_SUITE, () => {
  it(T6, async () => {
    const file = makeFile(F_ESSAY, C_MD_WITH_H1)
    const promise = parseMarkdownFile(file)
    vi.runAllTimers()
    const result = await promise
    expect(result.title).toBe(V_MY_TITLE)
  })

  it(T7, async () => {
    const file = makeFile(F_MY_DRAFT, C_MD_NO_H1)
    const promise = parseMarkdownFile(file)
    vi.runAllTimers()
    const result = await promise
    expect(result.title).toBe(V_MY_DRAFT_TITLE)
  })

  it(T8, async () => {
    const file = makeFile(F_TEST, C_MD_HEADING)
    const promise = parseMarkdownFile(file)
    vi.runAllTimers()
    const result = await promise
    expect(result.body_json.type).toBe(V_DOC)
    expect(Array.isArray(result.body_json.content)).toBe(true)
  })

  it(T9, async () => {
    const bigContent = C_MD_HUGE_PREFIX + CHAR_X.repeat(5 * 1024 * 1024)
    const file = makeFile(F_HUGE_MD, bigContent)
    await expect(parseMarkdownFile(file)).rejects.toThrow(V_TOO_LARGE)
  })
})
