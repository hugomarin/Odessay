import { notFound } from "next/navigation"

import { SelectionBarHarnessClient } from "@/app/perf/selection-bar-harness/selection-bar-harness-client"

/**
 * ODE-428 — evidence harness for the shared selection bar.
 *
 * Renders the same component twice, once with the Desk's action set and once
 * with the Settings › Archived artifacts set, so the side-by-side capture proves
 * the claim the spec makes: the two surfaces are one component, and only the
 * actions differ.
 */
export default function SelectionBarHarnessPage() {
  // The gate lives in the server component: a client-only check reads
  // `process.env` as undefined in the browser and de-hydrates the page.
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    notFound()
  }

  return <SelectionBarHarnessClient />
}
