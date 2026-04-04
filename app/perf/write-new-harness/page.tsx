import { EditorShell } from "@/components/editor/editor-shell"

// Perf harness for the "create new writing → paste" scenario (ODE-82).
// Renders EditorShell without a writingId so the new-writing creation path is exercised.
export default function WriteNewHarnessPage() {
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    return null
  }

  return <EditorShell />
}
