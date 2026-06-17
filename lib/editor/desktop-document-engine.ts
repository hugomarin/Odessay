import type { Editor, JSONContent } from "@tiptap/core"
import {
  parseDocumentFileToSnapshot,
  serializeDocumentToMarkdown,
  serializeEditorToMarkdown,
  type CanonicalDocumentFileSnapshot,
  type DocumentSerializationSnapshot,
} from "@/lib/editor/document-serialization"
import type { CanonicalDocumentMetadata } from "@/lib/editor/document-profile"
import { normalizeMarkdownForRoundTrip } from "@/lib/editor/markdown-format"

export type DesktopSerializeResult =
  | { success: true; markdown: string }
  | { success: false; error: string }

export type DesktopParseResult =
  | { success: true; snapshot: DocumentSerializationSnapshot }
  | { success: false; error: string }

export type DesktopParseFileResult =
  | { success: true; document: CanonicalDocumentFileSnapshot }
  | { success: false; error: string }

export type DesktopRoundTripResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Desktop Document Engine — canonical parse/serialize for the write-path desktop.
 *
 * Architecture Contract §ODE-209:
 * - Uses serializeDocumentToMarkdown / parseMarkdownToSnapshot as the ONLY canonical paths.
 * - No direct tiptap-markdown or buildWritingMarkdown calls in the write-path.
 * - Round-trip errors are explicit, never silent degradation.
 * - TipTap is a rich view of the .md; the .md is the source of truth at all times.
 */
export class DesktopDocumentEngine {
  /**
   * Switch Rich → Source: serialize current ProseMirror state to canonical Markdown.
   *
   * Scope: mode toggle in desktop editor.
   * Performance: operates on the existing editor instance; no new TipTap creation.
   */
  richToSource(editor: Editor): DesktopSerializeResult {
    try {
      const markdown = serializeEditorToMarkdown(editor)
      return { success: true, markdown }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Rich→Source serialization failed",
      }
    }
  }

  /**
   * Switch Source → Rich: parse canonical Markdown to ProseMirror JSON.
   *
   * Scope: mode toggle in desktop editor.
   * Performance: creates a temporary TipTap instance for parsing. For documents
   * under ~1000 words this completes in < 50ms in typical hardware.
   */
  sourceToRich(markdown: string): DesktopParseResult {
    try {
      const snapshot = parseDocumentFileToSnapshot(markdown).snapshot
      return { success: true, snapshot }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Source→Rich parse failed",
      }
    }
  }

  /**
   * Parse a canonical source document that may include front-matter.
   *
   * Scope: filesystem-backed write-path where the file itself is the contract.
   */
  parseSourceDocument(source: string): DesktopParseFileResult {
    try {
      const document = parseDocumentFileToSnapshot(source)
      return { success: true, document }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Source document parse failed",
      }
    }
  }

  /**
   * Serialize a ProseMirror JSON document to canonical Markdown.
   *
   * Use this when you have raw JSONContent (e.g. from an API or file) and need
   * the canonical .md representation without an active editor instance.
   */
  serializeBodyJson(bodyJson: JSONContent | null | undefined): DesktopSerializeResult {
    try {
      const markdown = serializeDocumentToMarkdown(bodyJson)
      return { success: true, markdown }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "JSON→Markdown serialization failed",
      }
    }
  }

  /**
   * Serialize a canonical source document as markdown content only.
   *
   * The metadata parameter is accepted for legacy call sites, but Odessay
   * metadata now lives in the cloud record + IndexedDB mirror, never in .md
   * frontmatter.
   */
  serializeSourceDocument(
    bodyJson: JSONContent | null | undefined,
    metadata: CanonicalDocumentMetadata,
  ): DesktopSerializeResult {
    try {
      void metadata
      const markdown = serializeDocumentToMarkdown(bodyJson)
      return { success: true, markdown }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Document file serialization failed",
      }
    }
  }

  /**
   * Validate that a markdown string survives a full Rich → Source → Rich round-trip
   * without degradation within the supported Markdown profile.
   *
   * Returns ok=true if the normalized markdown is bit-identical after the cycle.
   * Returns ok=false with an explicit error if anything degrades.
   */
  validateRoundTrip(markdown: string): DesktopRoundTripResult {
    const parsedDocument = this.parseSourceDocument(markdown)
    if (!parsedDocument.success) {
      return { ok: false, error: parsedDocument.error }
    }

    const serialized =
      parsedDocument.document.metadata !== null
        ? this.serializeSourceDocument(parsedDocument.document.snapshot.bodyJson, parsedDocument.document.metadata)
        : this.serializeBodyJson(parsedDocument.document.snapshot.bodyJson)
    if (!serialized.success) {
      return { ok: false, error: serialized.error }
    }

    const reparsedDocument = this.parseSourceDocument(serialized.markdown)
    if (!reparsedDocument.success) {
      return { ok: false, error: reparsedDocument.error }
    }

    const normalizedOriginal = normalizeMarkdownForRoundTrip(parsedDocument.document.markdown)
    const normalizedRoundTrip = normalizeMarkdownForRoundTrip(reparsedDocument.document.snapshot.markdown)

    if (normalizedOriginal !== normalizedRoundTrip) {
      return {
        ok: false,
        error: `Round-trip mismatch.\nOriginal:\n${normalizedOriginal}\nRound-trip:\n${normalizedRoundTrip}`,
      }
    }

    return { ok: true }
  }
}

/** Singleton instance for the desktop app. */
export const desktopDocumentEngine = new DesktopDocumentEngine()
