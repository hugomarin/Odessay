import { Suspense } from "react"
import { notFound } from "next/navigation"

import { PreviewOverlayHarnessClient } from "@/app/perf/preview-overlay-harness/preview-overlay-harness-client"

/**
 * ODE-434 — evidence harness for the artifact preview overlay.
 *
 * Seeds a handful of artifacts into the local store and opens the real
 * `WritingPreviewModal` over them, so the side-by-side capture compares the
 * shipped overlay against `Artifact Studio Desk.dc.html` rather than a mock-up,
 * and the ← → walk over ten artifacts can be recorded for the network gate.
 */
export default function PreviewOverlayHarnessPage() {
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    notFound()
  }

  return (
    <Suspense>
      <PreviewOverlayHarnessClient />
    </Suspense>
  )
}
