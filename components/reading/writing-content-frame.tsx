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
    <div className="WritingContentFrame relative mx-auto w-full max-w-[660px] px-5 pb-16 pt-10 sm:px-10 sm:pb-20 sm:pt-14">
      {children ? <div className="WritingContentFrameHeader">{children}</div> : null}

      {showTitle ? (
        <h1 className="mb-6 font-lora text-[24px] font-medium leading-[1.2] tracking-[-0.01em] text-ink sm:mb-8 sm:text-[30px]">
          {title ?? "Untitled"}
        </h1>
      ) : null}

      <div
        ref={bodyRef}
        id={bodyId}
        data-section={bodyId}
        data-testid={bodyTestId}
        className="prose-odessay"
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />

      <SelectionPreviewLayer rects={selectionPreviewRects ?? null} />
    </div>
  )
}
