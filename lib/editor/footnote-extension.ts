import { Extension } from "@tiptap/core"

const FOOTNOTE_REFERENCE_REGEX = /\[\^(\d+)\]/g
const FOOTNOTE_DEFINITION_REGEX = /^\[\^(\d+)\]:\s*(.*)$/gm

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const collectDefinitions = (markdown: string) => {
  const definitions = new Map<number, string>()

  for (const match of markdown.matchAll(FOOTNOTE_DEFINITION_REGEX)) {
    const index = Number(match[1])

    if (!Number.isNaN(index)) {
      definitions.set(index, match[2].trim())
    }
  }

  return definitions
}

const stripDefinitions = (markdown: string) => {
  const lines = markdown.split("\n")
  const keptLines: string[] = []

  for (const line of lines) {
    if (line.match(/^\[\^\d+\]:\s*/)) {
      continue
    }

    keptLines.push(line)
  }

  return keptLines.join("\n").trimEnd()
}

const getReferenceOrder = (markdown: string) => {
  const orderedUnique: number[] = []

  for (const match of markdown.matchAll(FOOTNOTE_REFERENCE_REGEX)) {
    const index = Number(match[1])

    if (!Number.isNaN(index) && !orderedUnique.includes(index)) {
      orderedUnique.push(index)
    }
  }

  return orderedUnique
}

const composeMarkdownWithDefinitions = (body: string, definitions: Map<number, string>) => {
  const trimmedBody = body.trimEnd()
  const orderedReferences = getReferenceOrder(trimmedBody)

  if (!orderedReferences.length) {
    return trimmedBody
  }

  const definitionLines = orderedReferences.map((reference) =>
    `[^${reference}]: ${definitions.get(reference) ?? ""}`.trimEnd(),
  )

  return `${trimmedBody}\n\n${definitionLines.join("\n")}`
}

const remapReferences = (markdown: string, orderedReferences: number[]) => {
  const mapping = new Map<number, number>()

  for (let index = 0; index < orderedReferences.length; index += 1) {
    mapping.set(orderedReferences[index], index + 1)
  }

  let remapped = markdown

  for (const [from, to] of mapping.entries()) {
    if (from === to) {
      continue
    }

    remapped = remapped.replaceAll(
      new RegExp(`\\[\\^${escapeRegExp(String(from))}\\]`, "g"),
      `[^__tmp_${from}__]`,
    )
  }

  for (const [from, to] of mapping.entries()) {
    if (from === to) {
      continue
    }

    remapped = remapped.replaceAll(`[^__tmp_${from}__]`, `[^${to}]`)
  }

  return { remapped, mapping }
}

export const normalizeMarkdownFootnotes = (markdown: string) => {
  const definitions = collectDefinitions(markdown)
  const body = stripDefinitions(markdown)
  const orderedReferences = getReferenceOrder(body)
  const { remapped, mapping } = remapReferences(body, orderedReferences)

  if (!orderedReferences.length) {
    return remapped.trimEnd()
  }

  const remappedDefinitions = new Map<number, string>()

  for (const originalReference of orderedReferences) {
    const remappedIndex = mapping.get(originalReference) ?? originalReference
    const definition = definitions.get(originalReference) ?? ""
    remappedDefinitions.set(remappedIndex, definition)
  }

  return composeMarkdownWithDefinitions(remapped, remappedDefinitions)
}

export const appendMarkdownFootnote = (markdown: string, note: string) => {
  const normalized = normalizeMarkdownFootnotes(markdown)
  const body = stripDefinitions(normalized)
  const definitions = collectDefinitions(normalized)
  const nextIndex = getReferenceOrder(body).length + 1
  const nextBody = `${body}[^${nextIndex}]`

  definitions.set(nextIndex, note.trim())

  return composeMarkdownWithDefinitions(nextBody, definitions)
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      addFootnote: (text: string) => ReturnType
    }
  }
}

export const FootnoteExtension = Extension.create({
  name: "footnote",

  addCommands() {
    return {
      addFootnote:
        (text: string) =>
        ({ editor }) => {
          const trimmedText = text.trim()

          if (!trimmedText) {
            return false
          }

          const currentMarkdown =
            (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? ""
          const withNormalizedState = normalizeMarkdownFootnotes(currentMarkdown)

          if (withNormalizedState !== currentMarkdown) {
            editor.commands.setContent(withNormalizedState)
          }

          const latestMarkdown =
            (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ??
            withNormalizedState
          const nextIndex = getReferenceOrder(latestMarkdown).length + 1

          editor.chain().focus().insertContent(`[^${nextIndex}]`).run()

          const markdownAfterInsert =
            (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ??
            latestMarkdown
          const normalizedWithDefinition = appendMarkdownFootnote(markdownAfterInsert, trimmedText)

          editor.commands.setContent(normalizedWithDefinition)

          return true
        },
    }
  },
})
