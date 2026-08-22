import { Suspense } from "react"
import { notFound } from "next/navigation"
import { EmptyStatesEvidenceClient } from "./empty-states-evidence-client"

/**
 * Fidelity-gate evidence for the three empty and first-run states.
 *
 * `?state=first-run|no-artifacts|no-workspace` switches the sheet. The rail, the
 * view header and the sheet are the real components over fixtures, so a
 * screenshot here shows the shipped composition — including the requirement that
 * the header and the rail stay visible in every state.
 */
export default function EmptyStatesEvidencePage() {
  if (process.env.VERCEL === "1") notFound()

  return (
    <Suspense fallback={null}>
      <EmptyStatesEvidenceClient />
    </Suspense>
  )
}
