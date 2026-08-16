import { notFound } from "next/navigation"

import { OverlayHarnessClient } from "@/app/perf/overlay-harness/overlay-harness-client"

export default function OverlayHarnessPage() {
  // The gate lives in the server component: a client-only check reads
  // `process.env` as undefined in the browser and de-hydrates the page.
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    notFound()
  }

  return <OverlayHarnessClient />
}
