"use client"

import { cn } from "@/lib/utils"

type DocumentActionToastProps = {
  kind: "success" | "error"
  message: string
  className?: string
}

export function DocumentActionToast({ kind, message, className }: DocumentActionToastProps) {
  return (
    <div
      data-testid="document-action-toast"
      data-notice={kind}
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-12 left-1/2 z-50 w-max max-w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[8px] border-[0.5px] border-border bg-sb px-3 py-2 text-center text-[11px] shadow-float-md",
        kind === "error" ? "text-[hsl(0,72%,45%)]" : "text-ink-3",
        className,
      )}
    >
      {message}
    </div>
  )
}
