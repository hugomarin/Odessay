import { notFound } from "next/navigation"
import { EditorShell } from "@/components/editor/editor-shell"

export default function EditorPerfHarnessPage() {
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    notFound()
  }

  // CI runners start from a clean localDB, so the perf harness must exercise a
  // guaranteed editor boot path instead of assuming a pre-existing writing id.
  return <EditorShell forceNewWriting />
}
