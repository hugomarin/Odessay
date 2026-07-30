import { Suspense } from "react"
import { notFound } from "next/navigation"
import { SettingsArchivedEvidenceClient } from "./settings-archived-evidence-client"

export default function SettingsArchivedEvidencePage() {
  if (process.env.VERCEL === "1") notFound()

  return <Suspense fallback={null}><SettingsArchivedEvidenceClient /></Suspense>
}
