"use client"

import { Button } from "@/components/ui/button"

type EditorEmptyStateProps = {
  onNewWriting: () => void
}

export function EditorEmptyState({ onNewWriting }: EditorEmptyStateProps) {
  return (
    <div
      id="editor-empty-state"
      data-section="editor-empty-state"
      data-testid="editor-empty-state"
      className="EditorEmptyState flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center"
    >
      <p className="max-w-[280px] font-lora italic text-[15px] leading-relaxed text-ink-3">
        No writings open.
      </p>
      <Button onClick={onNewWriting}>New Artifact</Button>
    </div>
  )
}
