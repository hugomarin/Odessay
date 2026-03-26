import { notFound } from "next/navigation"
import { EditorShell } from "@/components/editor/editor-shell"

export default function EditorPerfHarnessPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <EditorShell writingId="perf-harness-writing" />
}
