"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ReadingView } from "@/components/reading/reading-view"
import { DesktopSharedCopyDialog } from "@/components/reading/desktop-shared-copy-dialog"
import { loadDesktopSharedReading } from "@/lib/services/shared-reading-service"
import type { DesktopSharedReadingPayload } from "@/lib/services/shared-reading-service"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"

export function DesktopSharedEntry() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const identifier = searchParams.get("id") ?? ""
  const copyRequested = searchParams.get("copy") === "1"
  const [state, setState] = useState<{
    isLoading: boolean
    error: string | null
    payload: DesktopSharedReadingPayload | null
  }>({
    isLoading: true,
    error: null,
    payload: null,
  })

  useEffect(() => {
    if (!identifier) {
      setState({
        isLoading: false,
        error: "Choose a shared writing from Desk to open it here.",
        payload: null,
      })
      return
    }

    setState((current) => ({ ...current, isLoading: true, error: null }))

    void loadDesktopSharedReading(identifier).then((result) => {
      if (result.error || !result.data) {
        setState({
          isLoading: false,
          error: result.error?.message ?? "Failed to load shared writing.",
          payload: null,
        })
        return
      }

      setState({
        isLoading: false,
        error: null,
        payload: result.data,
      })
    })
  }, [identifier])

  const copyHref = useMemo(() => {
    if (!state.payload) {
      return null
    }

    return `${buildWritingRouteHref("/shared", { id: state.payload.writing.id, slug: null })}&copy=1`
  }, [state.payload])

  const handleCopyDialogOpenChange = (open: boolean) => {
    if (open || !state.payload) {
      return
    }

    router.replace(buildWritingRouteHref("/shared", { id: state.payload.writing.id, slug: null }))
  }

  if (state.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6">
        <p className="text-[14px] text-ink-4">Loading shared writing…</p>
      </main>
    )
  }

  if (state.error || !state.payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6">
        <div className="max-w-[420px] text-center">
          <p className="font-lora text-[22px] italic text-ink-3">{state.error ?? "Shared writing not found."}</p>
        </div>
      </main>
    )
  }

  return (
    <>
      <ReadingView
        writing={state.payload.writing}
        author={state.payload.author}
        prevWritingId={state.payload.prevWritingId}
        nextWritingId={state.payload.nextWritingId}
        prevWritingHref={state.payload.prevWritingHref}
        nextWritingHref={state.payload.nextWritingHref}
        sequencePosition={state.payload.sequencePosition}
        sequenceTotal={state.payload.sequenceTotal}
        canRespond={false}
        backUrl="/desk?tab=shared"
        isAuthenticated={false}
        extraActionHref={copyHref}
        extraActionLabel="Save as my copy"
      />

      <DesktopSharedCopyDialog
        open={copyRequested}
        identifier={identifier}
        writingTitle={state.payload.writing.title}
        onOpenChange={handleCopyDialogOpenChange}
      />
    </>
  )
}
