"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  SelectionBarFrame,
  type SelectionBarPlacement,
} from "@/components/shared/selection-bar-frame"

const NOTICE_DURATION_MS = 3000

export type MarkdownExportNoticeState = "success" | "error" | null

/** Adds the shared, short lived notice around a Markdown export action. */
export function useMarkdownExportNotice(exportMarkdown: (writingId: string) => Promise<boolean>) {
  const [notice, setNotice] = useState<MarkdownExportNoticeState>(null)
  const requestId = useRef(0)

  useEffect(() => {
    if (!notice) return

    const timeout = window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const runExport = useCallback(async (writingId: string) => {
    const request = ++requestId.current
    setNotice(null)

    try {
      const exported = await exportMarkdown(writingId)
      if (request === requestId.current) {
        setNotice(exported ? "success" : null)
      }
      return exported
    } catch {
      if (request === requestId.current) {
        setNotice("error")
      }
      return false
    }
  }, [exportMarkdown])

  return { notice, runExport }
}

export function MarkdownExportNotice({
  notice,
  placement = "fixed",
  raised = false,
}: {
  notice: MarkdownExportNoticeState
  placement?: SelectionBarPlacement
  raised?: boolean
}) {
  return (
    <div
      data-testid="markdown-export-live-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {notice && (
        <SelectionBarFrame
          data-testid="markdown-export-notice"
          data-notice={notice}
          placement={placement}
          raised={raised}
        >
          <span className="text-[14px] font-medium text-bg">
            {notice === "success" ? "Markdown exported" : "Failed to export Markdown."}
          </span>
        </SelectionBarFrame>
      )}
    </div>
  )
}
