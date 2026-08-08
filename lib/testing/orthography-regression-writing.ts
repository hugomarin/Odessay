import { Editor } from "@tiptap/core"
import { adaptCorrectionsContract } from "@/lib/ai/corrections-contract-adapter"
import { CORRECTION_ENGINE_REVISION } from "@/lib/ai/corrections-config"
import { collectCorrectionBlocks } from "@/lib/editor/correction-trigger-plugin"
import { createEditorExtensions } from "@/lib/editor/extensions"
import { parseMarkdownToSnapshot } from "@/lib/editor/document-serialization"
import type { LocalCorrectionBlock, LocalWriting } from "@/lib/local-db/schema"
import {
  buildOrthographyRegressionCorrections,
  ORTHOGRAPHY_REGRESSION_AUTHOR_ID,
  ORTHOGRAPHY_REGRESSION_CREATED_AT,
  ORTHOGRAPHY_REGRESSION_MARKDOWN,
  ORTHOGRAPHY_REGRESSION_WRITING_ID,
} from "@/lib/testing/orthography-regression-fixture"

export const createOrthographyRegressionWriting = (): LocalWriting => {
  const snapshot = parseMarkdownToSnapshot(ORTHOGRAPHY_REGRESSION_MARKDOWN)

  return {
    id: ORTHOGRAPHY_REGRESSION_WRITING_ID,
    author_id: ORTHOGRAPHY_REGRESSION_AUTHOR_ID,
    title: "Orthography regression harness",
    body_json: snapshot.bodyJson,
    body_text: snapshot.bodyText,
    slug: null,
    status: "draft",
    artifact_type: "general",
    visibility: "private",
    version: 7,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: ORTHOGRAPHY_REGRESSION_CREATED_AT,
    updated_at: ORTHOGRAPHY_REGRESSION_CREATED_AT,
    content_updated_at: ORTHOGRAPHY_REGRESSION_CREATED_AT,
    metadata_updated_at: ORTHOGRAPHY_REGRESSION_CREATED_AT,
    local_updated_at: Date.parse(ORTHOGRAPHY_REGRESSION_CREATED_AT),
  }
}

export const createOrthographyRegressionCorrectionBlocks = (): LocalCorrectionBlock[] => {
  const snapshot = parseMarkdownToSnapshot(ORTHOGRAPHY_REGRESSION_MARKDOWN)
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: snapshot.bodyJson,
  })

  try {
    const blocks: Array<LocalCorrectionBlock | null> = collectCorrectionBlocks(editor.state.doc).map((block) => {
        const corrections = buildOrthographyRegressionCorrections(block.id, block.text)
        if (corrections.length === 0) {
          return null
        }

        const adapted = adaptCorrectionsContract({
          summary: "Orthography regression fixture corrections.",
          language: "es",
          corrections,
          uncertain: [],
        })

        const suggestions: LocalCorrectionBlock["suggestions"] = adapted.legacy.suggestions.map((suggestion) => ({
          ...suggestion,
          source_hash: block.hash,
        }))

        return {
          id: `auto-correction:${ORTHOGRAPHY_REGRESSION_WRITING_ID}:${block.hash}`,
          writingId: ORTHOGRAPHY_REGRESSION_WRITING_ID,
          blockId: block.id,
          blockHash: block.hash,
          suggestions,
          model: "orthography-fixture",
          engineRevision: CORRECTION_ENGINE_REVISION,
          createdAt: ORTHOGRAPHY_REGRESSION_CREATED_AT,
          latencyMs: 12,
          promptTokens: 64,
          completionTokens: 24,
          syncedAt: ORTHOGRAPHY_REGRESSION_CREATED_AT,
        } satisfies LocalCorrectionBlock
      })

    return blocks.filter((block): block is LocalCorrectionBlock => block !== null)
  } finally {
    editor.destroy()
  }
}
