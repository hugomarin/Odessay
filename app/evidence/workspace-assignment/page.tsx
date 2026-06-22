import { notFound } from "next/navigation"
import { WorkspaceAssignmentEvidenceClient } from "@/app/evidence/workspace-assignment/workspace-assignment-evidence-client"

export default function WorkspaceAssignmentEvidencePage() {
  // Presentation Contract harness for ODE-318. Renders the shared Workspace
  // assignment control in every state for headless capture. Never expose it on
  // Vercel-hosted environments.
  if (process.env.VERCEL === "1") {
    notFound()
  }

  return <WorkspaceAssignmentEvidenceClient />
}
