"use client"

import type { AnnotationType } from "@/lib/editor/footnote-node"
import type { WritingAnnotationNode } from "@/lib/editor/footnote-extension"
import { cn } from "@/lib/utils"

type AnnotationsPreviewProps = {
  annotations: WritingAnnotationNode[]
  onSeeAll: () => void
}

const MAX_PREVIEW = 3

const ANNOTATION_TYPE_LABEL: Record<AnnotationType, string> = {
  personal: "Personal",
  ai: "AI",
  footnote: "Footnote",
  highlight: "Highlight",
}

const getAnnotationLabel = (type: AnnotationType) => ANNOTATION_TYPE_LABEL[type] ?? "Note"

const getAnnotationText = (annotation: WritingAnnotationNode) => {
  const note = annotation.text?.trim()
  if (note) {
    return note
  }

  const anchor = annotation.anchor_text?.trim()
  return anchor ? `“${anchor}”` : "Untitled annotation"
}

export function AnnotationsPreview({ annotations, onSeeAll }: AnnotationsPreviewProps) {
  const total = annotations.length
  const previewItems = annotations.slice(0, MAX_PREVIEW)
  const remaining = total - previewItems.length

  return (
    <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border bg-bg">
      <div className="flex items-center justify-between px-3 py-[9px]">
        <span className="text-[12px] font-medium text-ink-2">
          {total === 0 ? "No annotations yet" : `${total} ${total === 1 ? "annotation" : "annotations"}`}
        </span>
        {total > 0 ? (
          <button
            type="button"
            onClick={onSeeAll}
            className="text-[11px] font-medium text-ink-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3 rounded-[4px]"
          >
            See all
          </button>
        ) : null}
      </div>

      {previewItems.length > 0 ? (
        <ul className="border-t-[0.5px] border-border">
          {previewItems.map((annotation) => (
            <li
              key={annotation.id}
              className="flex items-center gap-2 border-b-[0.5px] border-border px-3 py-[9px] last:border-b-0"
            >
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-[6px] border-[0.5px] border-[hsl(30_16%_78%)] bg-[hsl(34_30%_92%)] px-[7px] py-[1px] text-[10px] font-medium tracking-[0.01em] text-[hsl(28_22%_22%)]",
                )}
              >
                {getAnnotationLabel(annotation.type)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
                {getAnnotationText(annotation)}
              </span>
            </li>
          ))}
          {remaining > 0 ? (
            <li className="px-3 py-[7px] text-[11px] text-ink-4">+{remaining} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
