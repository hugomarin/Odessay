"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export type SelectionBarPlacement = "fixed" | "absolute"

export type SelectionBarFrameProps = React.HTMLAttributes<HTMLDivElement> & {
  placement?: SelectionBarPlacement
  raised?: boolean
}

/** Shared floating frame used by the selection bar and its action notices. */
export const SelectionBarFrame = React.forwardRef<HTMLDivElement, SelectionBarFrameProps>(
  function SelectionBarFrame({ children, placement = "fixed", raised = false, className, ...props }, ref) {
    return (
      <div
        {...props}
        ref={ref}
        data-placement={placement}
        className={cn(
          "pointer-events-none inset-x-0 z-40 flex h-14 items-center justify-center",
          raised ? "bottom-[96px]" : "bottom-[26px]",
          placement === "fixed" ? "fixed" : "absolute",
          className,
        )}
      >
        <div className="pointer-events-auto flex h-14 origin-center animate-bar-in items-center gap-2.5 whitespace-nowrap rounded-bar bg-ink pl-[22px] pr-3.5 shadow-selection-bar">
          {children}
        </div>
      </div>
    )
  },
)

SelectionBarFrame.displayName = "SelectionBarFrame"
