import type { ReactNode, RefObject } from "react"
import { SelectionPreviewLayer, type SelectionPreviewRect } from "./margins/selection-preview-layer"

type WritingContentFrameProps = {
  title?: string | null
  bodyHtml: string
  bodyId: string
  bodyTestId: string
  bodyRef?: RefObject<HTMLDivElement | null>
  selectionPreviewRects?: SelectionPreviewRect[] | null
  children?: ReactNode
  showTitle?: boolean
}

export function WritingContentFrame({
  title,
  bodyHtml,
  bodyId,
  bodyTestId,
  bodyRef,
  selectionPreviewRects,
  children,
  showTitle = true,
}: WritingContentFrameProps) {
  return (
    <div className="WritingContentFrame odessay-content-frame relative">
      {children ? <div className="WritingContentFrameHeader">{children}</div> : null}

      {showTitle ? (
        <h1 className="odessay-writing-title mb-6 text-[24px] font-medium leading-[1.2] tracking-[-0.01em] text-ink sm:mb-8 sm:text-[30px]">
          {title ?? "Untitled"}
        </h1>
      ) : null}

      <div className="relative">
        <div
          ref={bodyRef}
          id={bodyId}
          data-section={bodyId}
          data-testid={bodyTestId}
          className="prose-odessay odessay-rich-content"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

        <SelectionPreviewLayer rects={selectionPreviewRects ?? null} />
      </div>
    </div>
  )
}
