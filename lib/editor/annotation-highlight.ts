import Highlight from "@tiptap/extension-highlight"
import { ANNOTATION_TYPES, type AnnotationType } from "@/lib/editor/footnote-node"

export const coerceHighlightAnnotationType = (value: unknown): AnnotationType | null => {
  if (value === "collaborative") return "personal"
  return typeof value === "string" && ANNOTATION_TYPES.includes(value as AnnotationType)
    ? (value as AnnotationType)
    : value == null
      ? null
      : "highlight"
}

export const AnnotationHighlight = Highlight.extend({
  addAttributes() {
    return {
      annotationType: {
        default: null,
        parseHTML: (element) =>
          coerceHighlightAnnotationType(element.getAttribute("data-annotation-type")),
        renderHTML: (attrs) => {
          const annotationType = coerceHighlightAnnotationType(attrs.annotationType)
          return annotationType ? { "data-annotation-type": annotationType } : {}
        },
      },
    }
  },
})
