"use client"

export type SelectionPreviewRect = {
  top: number
  left: number
  width: number
  height: number
  key: string
}

type SelectionPreviewLayerProps = {
  rects: SelectionPreviewRect[] | null
}

export function SelectionPreviewLayer({ rects }: SelectionPreviewLayerProps) {
  if (!rects?.length) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 18 }}
    >
      {rects.map((rect) => (
        <span
          key={rect.key}
          className="absolute rounded-[2px] bg-[hsl(45_90%_84%/_0.56)]"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
    </div>
  )
}
