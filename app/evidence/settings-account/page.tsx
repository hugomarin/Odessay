import { Suspense } from "react"
import { notFound } from "next/navigation"
import { SettingsAccountEvidenceClient } from "@/app/evidence/settings-account/settings-account-evidence-client"

export default function SettingsAccountEvidencePage() {
  // The evidence harness accepts credentials via query params for local/headless
  // capture only. Never expose it on Vercel-hosted environments.
  if (process.env.VERCEL === "1") {
    notFound()
  }

  return (
    <Suspense fallback={<div data-testid="ode-221-settings-harness">Loading harness...</div>}>
      <SettingsAccountEvidenceClient />
    </Suspense>
  )
}
