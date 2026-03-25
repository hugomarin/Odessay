"use client"

import type { ComponentProps, ReactElement } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type ActionTooltipProps = {
  label: string
  shortcut?: string | null
  side?: ComponentProps<typeof TooltipContent>["side"]
  align?: ComponentProps<typeof TooltipContent>["align"]
  contentClassName?: string
  children: ReactElement
}

export function ActionTooltip({
  label,
  shortcut,
  side = "top",
  align = "center",
  contentClassName,
  children,
}: ActionTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        className={cn("flex items-center gap-2", contentClassName)}
      >
        <span>{label}</span>
        {shortcut ? <span className="font-mono text-[11px] text-bg/70">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}
