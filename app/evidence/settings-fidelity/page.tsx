import { Suspense } from "react"
import { notFound } from "next/navigation"
import { SettingsFidelityEvidenceClient } from "./settings-fidelity-evidence-client"

/**
 * Fidelity-gate evidence for the Settings redesign.
 *
 * `?section=account|types|status` switches the sheet. The shell, nav, header,
 * cards and the editor modal are the real components over fixtures, so a
 * screenshot here is a screenshot of the shipped surface rather than a mock-up
 * of it. Archived has its own route because it needs a service double.
 */
export default function SettingsFidelityEvidencePage() {
  if (process.env.VERCEL === "1") notFound()

  return (
    <Suspense fallback={null}>
      <SettingsFidelityEvidenceClient />
    </Suspense>
  )
}
