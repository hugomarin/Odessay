import { Suspense } from "react"
import { notFound } from "next/navigation"

import { DeskHarnessClient } from "@/app/perf/desk-harness/desk-harness-client"

/**
 * ODE-430 — evidence harness for the redesigned Desk.
 *
 * Renders the real header, toolbar, sheet, rows and selection bar over fixture
 * rows shaped like the ones the prototype shows, so the side-by-side capture
 * compares the shipped components against `Artifact Studio Desk.dc.html` rather
 * than a mock-up of them. `?state=` selects the state to capture.
 */
export default function DeskHarnessPage() {
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    notFound()
  }

  // `?state=` is read with useSearchParams, which needs a boundary to prerender.
  return (
    <Suspense>
      <DeskHarnessClient />
    </Suspense>
  )
}
