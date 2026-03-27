import { notFound } from "next/navigation"
import { EditorShell } from "@/components/editor/editor-shell"

export default function EditorPerfHarnessPage() {
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    notFound()
  }

  return <EditorShell writingId="perf-harness-writing" />
}
