import { Extension } from "@tiptap/core"
import type { Editor as TiptapEditor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { hashCorrectionBlock } from "@/lib/ai/corrections"

export type CorrectionTriggerBlock = {
  id: string
  pos: number
  nodeSize: number
  nodeType: string
  text: string
  hash: string
  wordCount: number
}

type CorrectionTriggerState = {
  dirtyBlocks: CorrectionTriggerBlock[]
  revision: number
}

const correctionTriggerEventName = "odessay:correction-dirty-blocks"

export const correctionTriggerPluginKey = new PluginKey<CorrectionTriggerState>("odessay-correction-trigger")

const ANALYSIS_NODE_TYPES = new Set(["paragraph", "heading", "listItem", "taskItem"])
const EXCLUDED_NODE_TYPES = new Set(["codeBlock"])

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

const isAnalysisNode = (node: ProseMirrorNode) =>
  ANALYSIS_NODE_TYPES.has(node.type.name) &&
  !EXCLUDED_NODE_TYPES.has(node.type.name) &&
  node.textContent.trim().length > 0

const rangesIntersect = (leftFrom: number, leftTo: number, rightFrom: number, rightTo: number) =>
  leftFrom < rightTo && leftTo > rightFrom

const toCorrectionBlock = (node: ProseMirrorNode, pos: number): CorrectionTriggerBlock => {
  const text = node.textContent.trim()
  const hash = hashCorrectionBlock(text)

  return {
    id: `correction-block:${hash}:${pos}`,
    pos,
    nodeSize: node.nodeSize,
    nodeType: node.type.name,
    text,
    hash,
    wordCount: countWords(text),
  }
}

export const collectCorrectionBlocks = (doc: ProseMirrorNode): CorrectionTriggerBlock[] => {
  const blocks: CorrectionTriggerBlock[] = []

  doc.descendants((node, pos) => {
    if (EXCLUDED_NODE_TYPES.has(node.type.name)) {
      return false
    }

    if (!isAnalysisNode(node)) {
      return true
    }

    blocks.push(toCorrectionBlock(node, pos))

    if (node.type.name === "listItem" || node.type.name === "taskItem") {
      return false
    }

    return true
  })

  return blocks
}

export const collectCorrectionBlocksInRanges = (
  doc: ProseMirrorNode,
  ranges: Array<{ from: number; to: number }>,
) => {
  if (ranges.length === 0) {
    return []
  }

  const byId = new Map<string, CorrectionTriggerBlock>()

  for (const range of ranges) {
    const from = Math.max(0, Math.min(doc.content.size, range.from))
    const to = Math.max(from, Math.min(doc.content.size, range.to))

    doc.nodesBetween(from, to, (node, pos, parent) => {
      if (EXCLUDED_NODE_TYPES.has(node.type.name)) {
        return false
      }

      if (!isAnalysisNode(node)) {
        return true
      }

      if (
        node.type.name === "paragraph" &&
        (parent?.type.name === "listItem" || parent?.type.name === "taskItem")
      ) {
        return false
      }

      const block = toCorrectionBlock(node, pos)

      if (rangesIntersect(block.pos, block.pos + block.nodeSize, Math.max(0, from - 1), Math.min(doc.content.size, to + 1))) {
        byId.set(block.id, block)
      }

      if (node.type.name === "listItem" || node.type.name === "taskItem") {
        return false
      }

      return true
    })
  }

  return [...byId.values()].sort((left, right) => left.pos - right.pos)
}

export const getCurrentCorrectionBlock = (
  doc: ProseMirrorNode,
  blockId: string,
): CorrectionTriggerBlock | null => collectCorrectionBlocks(doc).find((block) => block.id === blockId) ?? null

export const acknowledgeCorrectionDirtyBlocks = (editor: TiptapEditor, blockIds: string[]) => {
  if (blockIds.length === 0) {
    return
  }

  const transaction = editor.state.tr
  transaction.setMeta(correctionTriggerPluginKey, { acknowledge: blockIds })
  transaction.setMeta("addToHistory", false)
  editor.view.dispatch(transaction)
}

const createCorrectionTriggerPlugin = () =>
  new Plugin<CorrectionTriggerState>({
    key: correctionTriggerPluginKey,
    state: {
      init: () => ({
        dirtyBlocks: [],
        revision: 0,
      }),
      apply: (transaction, pluginState) => {
        const meta = transaction.getMeta(correctionTriggerPluginKey) as { acknowledge?: string[] } | undefined
        const acknowledged = new Set(meta?.acknowledge ?? [])
        const mappedBlocks = pluginState.dirtyBlocks
          .filter((block) => !acknowledged.has(block.id))
          .map((block) => {
            const mapped = transaction.mapping.mapResult(block.pos, 1)
            return mapped.deleted ? null : { ...block, pos: mapped.pos }
          })
          .filter((block): block is CorrectionTriggerBlock => block !== null)

        if (!transaction.docChanged) {
          return acknowledged.size > 0
            ? {
                dirtyBlocks: mappedBlocks,
                revision: pluginState.revision + 1,
              }
            : pluginState
        }

        const ranges: Array<{ from: number; to: number }> = []
        for (const map of transaction.mapping.maps) {
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            ranges.push({ from: newStart, to: Math.max(newEnd, newStart + 1) })
          })
        }

        const changedBlocks = collectCorrectionBlocksInRanges(transaction.doc, ranges)
        const nextById = new Map(mappedBlocks.map((block) => [block.id, block]))

        for (const block of changedBlocks) {
          nextById.set(block.id, block)
        }

        return {
          dirtyBlocks: [...nextById.values()].sort((left, right) => left.pos - right.pos),
          revision: pluginState.revision + 1,
        }
      },
    },
    view: (view) => {
      let lastRevision = correctionTriggerPluginKey.getState(view.state)?.revision ?? 0

      return {
        update(nextView) {
          const state = correctionTriggerPluginKey.getState(nextView.state)

          if (!state || state.revision === lastRevision || state.dirtyBlocks.length === 0) {
            if (state) {
              lastRevision = state.revision
            }
            return
          }

          lastRevision = state.revision
          nextView.dom.dispatchEvent(
            new CustomEvent(correctionTriggerEventName, {
              bubbles: true,
              detail: {
                blocks: state.dirtyBlocks,
              },
            }),
          )
        },
      }
    },
  })

export const CorrectionTriggerExtension = Extension.create({
  name: "correctionTrigger",

  addProseMirrorPlugins() {
    return [createCorrectionTriggerPlugin()]
  },
})
