"use client"

import {
  Archive,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  Eye,
  XCircle,
} from "lucide-react"
import type { WritingStatus } from "@/lib/writings/status"

type WritingStatusIconProps = {
  status: WritingStatus
  className?: string
}

export function WritingStatusIcon({ status, className = "h-[13px] w-[13px]" }: WritingStatusIconProps) {
  switch (status) {
    case "draft":
      return <CircleDashed className={className} strokeWidth={1.5} />
    case "new":
      return <CircleDot className={className} strokeWidth={1.5} />
    case "exploring":
      return <CircleDashed className={className} strokeWidth={1.5} />
    case "in_review":
      return <Eye className={className} strokeWidth={1.5} />
    case "done":
      return <CheckCircle2 className={className} strokeWidth={1.5} />
    case "archived":
      return <Archive className={className} strokeWidth={1.5} />
    case "canceled":
      return <XCircle className={className} strokeWidth={1.5} />
    default:
      return <Circle className={className} strokeWidth={1.5} />
  }
}
