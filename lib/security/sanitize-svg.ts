import DOMPurify from "isomorphic-dompurify"

/**
 * Strips script-capable content from an uploaded SVG before it's stored.
 * Unlike raster formats, an SVG is XML markup a browser can execute
 * (<script>, on*= handlers, javascript: hrefs) if the file is ever opened as
 * a document rather than rendered inside an <img> tag — e.g. a signed
 * storage URL opened directly, or copy-pasted elsewhere. Runs both client
 * and server side (isomorphic-dompurify picks the right DOM implementation)
 * so neither the browser upload path nor a direct API call skips it.
 */
export function sanitizeSvgMarkup(markup: string): string {
  return DOMPurify.sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: true },
  })
}
