import type { JSONContent } from "@tiptap/core"
import { generateHTML } from "@tiptap/html"
import {
  containWideTables,
  WRITING_BODY_EXTENSIONS,
  isRenderableBodyJson,
  renderPlainTextHtml,
  sanitizeRenderInputs,
  type RenderWritingBodyHtmlOptions,
} from "@/lib/reading/render-body-html-core"

export const renderWritingBodyHtml = (
  bodyJson: JSONContent | null | undefined,
  bodyText: string | null | undefined,
  options: RenderWritingBodyHtmlOptions = {},
): { bodyHtml: string; mode: "rich" | "plain-text" } => {
  const { bodyJson: sanitizedBodyJson, bodyText: sanitizedBodyText } = sanitizeRenderInputs(bodyJson, bodyText)

  if (isRenderableBodyJson(sanitizedBodyJson)) {
    try {
      const renderRichHtml = options.renderRichHtml ?? ((value: JSONContent) => generateHTML(value, WRITING_BODY_EXTENSIONS))

      return {
        bodyHtml: containWideTables(renderRichHtml(sanitizedBodyJson)),
        mode: "rich",
      }
    } catch (error) {
      options.onRichRenderError?.(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    bodyHtml: renderPlainTextHtml(sanitizedBodyText),
    mode: "plain-text",
  }
}
