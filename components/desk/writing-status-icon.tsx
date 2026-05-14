"use client"

import { CheckCircle2, Circle, CircleDashed, CircleDot } from "lucide-react"
import type { WritingStatus } from "@/lib/writings/status"

type WritingStatusIconProps = {
  status: WritingStatus
  className?: string
}

export function WritingStatusIcon({ status, className = "h-[13px] w-[13px]" }: WritingStatusIconProps) {
  if (status === "done") {
    return <CheckCircle2 className={className} strokeWidth={1.5} />
  }

  if (status === "exploring") {
    return <CircleDashed className={className} strokeWidth={1.5} />
  }

  if (status === "new") {
    return <CircleDot className={className} strokeWidth={1.5} />
  }

  return <Circle className={className} strokeWidth={1.5} />
}
