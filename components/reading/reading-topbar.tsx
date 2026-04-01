"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { AlignLeft, ChevronLeft, ChevronRight, Edit3 } from "lucide-react"
import Link from "next/link"

type ReadingTopbarProps = {
  writingId: string
  backUrl: string
  prevWritingId: string | null
  nextWritingId: string | null
  sequencePosition: number | null
  sequenceTotal: number | null
  canRespond: boolean
  marginPanelOpen?: boolean
  onToggleMarginPanel?: () => void
  isAuthenticated?: boolean
  mode?: "default" | "public"
  publicHeader?: {
    logoHref: string
    accountHref: string
    accountLabel: string
  }
  respondHref?: string
}

export function ReadingTopbar({
  writingId,
  backUrl,
  prevWritingId,
  nextWritingId,
  sequencePosition,
  sequenceTotal,
  canRespond,
  marginPanelOpen = false,
  onToggleMarginPanel,
  isAuthenticated = false,
  mode = "default",
  publicHeader,
  respondHref,
}: ReadingTopbarProps) {
  const router = useRouter()
  const hasNav = prevWritingId !== null || nextWritingId !== null
  const resolvedRespondHref = respondHref ?? `/write?reply_to=${writingId}`

  useEffect(() => {
    if (mode === "public") return

    function handleKeydown(e: KeyboardEvent) {
      // Skip if user is typing in an input or textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return

      if (e.key === "ArrowLeft" && prevWritingId) {
        router.push(`/shared/${prevWritingId}`)
      } else if (e.key === "ArrowRight" && nextWritingId) {
        router.push(`/shared/${nextWritingId}`)
      } else if (e.key === "Escape") {
        // Preparation for margin/selection popup in the next issue — no-op for now
      }
    }

    document.addEventListener("keydown", handleKeydown)
    return () => document.removeEventListener("keydown", handleKeydown)
  }, [mode, prevWritingId, nextWritingId, router])

  if (mode === "public") {
    return (
      <div
        id="reading-chrome"
        data-section="reading-chrome"
        data-testid="reading-chrome"
        className="ReadingChrome flex h-[46px] shrink-0 items-center border-b-[0.5px] border-border bg-bg"
      >
        <div className="mx-auto flex h-full w-full max-w-[680px] items-center justify-between px-6">
          <Link href={publicHeader?.logoHref ?? "/"} className="font-lora text-[17px] text-ink">
            Odessay
          </Link>

          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <button
                onClick={onToggleMarginPanel}
                className={`flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors ${
                  marginPanelOpen
                    ? "bg-muted text-ink-2"
                    : "text-ink-4 hover:bg-muted hover:text-ink-2"
                }`}
                aria-label={marginPanelOpen ? "Close margins" : "Open margins"}
                aria-pressed={marginPanelOpen}
                title="Margins"
              >
                <AlignLeft strokeWidth={1.5} className="h-[14px] w-[14px]" />
              </button>
            ) : null}

            {publicHeader ? (
              <Link
                href={publicHeader.accountHref}
                className={`flex h-8 items-center justify-center rounded-[8px] border-[0.5px] border-border px-3 text-[12px] ${
                  isAuthenticated ? "font-semibold text-ink-2" : "font-medium text-ink-3"
                }`}
              >
                {publicHeader.accountLabel}
              </Link>
            ) : null}

            {canRespond ? (
              <Link
                href={resolvedRespondHref}
                className="ml-1 flex h-8 items-center gap-1.5 rounded-[8px] bg-cursor px-3.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
                data-testid="write-response-btn"
              >
                <Edit3 strokeWidth={1.5} className="h-[12px] w-[12px]" />
                Responder
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      id="reading-chrome"
      data-section="reading-chrome"
      data-testid="reading-chrome"
      className="ReadingChrome flex h-[46px] shrink-0 items-center justify-between border-b-[0.5px] border-border bg-bg px-8"
    >
      {/* Left — back */}
      <div className="flex items-center">
        <Link
          href={backUrl}
          className="flex items-center gap-1.5 text-[13px] text-ink-4 transition-colors hover:text-ink-3"
          aria-label="Go back"
        >
          <ChevronLeft strokeWidth={1.5} className="h-[13px] w-[13px]" />
          Back
        </Link>
      </div>

      {/* Center — sequence navigation */}
      <div className="flex items-center gap-1.5">
        {hasNav ? (
          <>
            <button
              onClick={() => prevWritingId && router.push(`/shared/${prevWritingId}`)}
              disabled={!prevWritingId}
              className="flex items-center gap-1 rounded-[7px] px-2.5 py-1.5 text-[12px] text-ink-4 transition-colors hover:bg-muted hover:text-ink-2 disabled:pointer-events-none disabled:opacity-30"
              aria-label="Previous writing"
            >
              <ChevronLeft strokeWidth={1.5} className="h-[12px] w-[12px]" />
              Previous
            </button>
            {sequencePosition !== null && sequenceTotal !== null ? (
              <span className="px-1 text-[12px] text-ink-4">
                {sequencePosition} of {sequenceTotal}
              </span>
            ) : null}
            <button
              onClick={() => nextWritingId && router.push(`/shared/${nextWritingId}`)}
              disabled={!nextWritingId}
              className="flex items-center gap-1 rounded-[7px] px-2.5 py-1.5 text-[12px] text-ink-4 transition-colors hover:bg-muted hover:text-ink-2 disabled:pointer-events-none disabled:opacity-30"
              aria-label="Next writing"
            >
              Next
              <ChevronRight strokeWidth={1.5} className="h-[12px] w-[12px]" />
            </button>
          </>
        ) : null}
      </div>

      {/* Right — tools */}
      <div className="flex items-center gap-1">
        {/* Margins toggle */}
        {isAuthenticated && (
          <button
            onClick={onToggleMarginPanel}
            className={`flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors ${
              marginPanelOpen
                ? "bg-muted text-ink-2"
                : "text-ink-4 hover:bg-muted hover:text-ink-2"
            }`}
            aria-label={marginPanelOpen ? "Close margins" : "Open margins"}
            aria-pressed={marginPanelOpen}
            title="Margins"
          >
            <AlignLeft strokeWidth={1.5} className="h-[14px] w-[14px]" />
          </button>
        )}

        {canRespond ? (
          <Link
            href={resolvedRespondHref}
            className="ml-1 flex h-8 items-center gap-1.5 rounded-[8px] bg-cursor px-3.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
            data-testid="write-response-btn"
          >
            <Edit3 strokeWidth={1.5} className="h-[12px] w-[12px]" />
            Write a response
          </Link>
        ) : null}
      </div>
    </div>
  )
}
