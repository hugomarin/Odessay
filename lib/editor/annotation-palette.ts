import type { AnnotationType } from "@/lib/editor/footnote-node"

export const ANNOTATION_TYPE_COLOR: Record<AnnotationType, string> = {
  footnote: "var(--od-annotation-muted)",
  personal: "var(--od-annotation-muted)",
  ai: "var(--od-annotation-ai)",
  highlight: "var(--od-annotation-highlight-badge)",
}
