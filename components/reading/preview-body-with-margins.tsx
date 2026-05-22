"use client"

import { useEffect, useRef, useState } from "react"
import { WritingContentFrame } from "./writing-content-frame"
import { HighlightLayer, type MarginHighlight } from "./margins/highlight-layer"
import type { MarginData } from "./margins/margin-entry"

type PreviewBodyWithMarginsProps = {
  token: string
  title: string
  bodyHtml: string
  updatedAt: string
  authorName: string
}

async function apiFetchPreviewMargins(token: string): Promise<MarginData[]> {
  const res = await fetch(`/api/margins/preview?token=${encodeURIComponent(token)}`)
  const json: { data: MarginData[] | null; error: { message: string } | null } = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message ?? "Failed to fetch margins")
  return json.data ?? []
}

export function PreviewBodyWithMargins({
  token,
  title,
  bodyHtml,
  updatedAt,
  authorName,
}: PreviewBodyWithMarginsProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [margins, setMargins] = useState<MarginData[]>([])

  useEffect(() => {
    apiFetchPreviewMargins(token)
      .then(setMargins)
      .catch((err) => {
        console.error("[preview:margins]", err)
      })
  }, [token])

  const highlightMargins: MarginHighlight[] = margins.map((m) => ({
    id: m.id,
    anchor_start: m.anchor_start,
    anchor_end: m.anchor_end,
    note: m.text ?? m.note ?? null,
  }))

  return (
    <div className="relative">
      <WritingContentFrame
        title={title}
        bodyHtml={bodyHtml}
        bodyId="preview-body"
        bodyTestId="preview-body"
        bodyRef={bodyRef}
        showTitle={false}
      >
        <div className="border-b-[0.5px] border-border pb-5">
          <p className="text-[12px] text-ink-4">
            By {authorName}
          </p>
          <p className="mt-3 text-[12px] text-ink-4">
            Updated {new Intl.DateTimeFormat("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(updatedAt))}
          </p>
        </div>
      </WritingContentFrame>

      <HighlightLayer
        bodyRef={bodyRef}
        margins={highlightMargins}
        onHighlightClick={() => {}}
      />
    </div>
  )
}
