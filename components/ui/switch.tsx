"use client"

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

type SwitchVariant = "default" | "settings"

const ROOT_VARIANTS: Record<SwitchVariant, string> = {
  default:
    "relative h-[18px] w-8 shrink-0 overflow-hidden rounded-[9px] border-0 bg-border transition-colors data-[state=checked]:bg-ink data-[state=unchecked]:bg-border",
  // Settings › Artifact types and Status draw a larger switch than the rest of
  // the app: 40×23 with a 17px thumb, read from the render of
  // `Artifact Studio Settings.dc.html`. The variant already existed as a copy of
  // `default`; ODE-432 gives it the geometry it was reserved for, leaving
  // `default` — and therefore every other consumer — untouched.
  settings:
    "relative h-[23px] w-10 shrink-0 overflow-hidden rounded-xl border-0 bg-border transition-colors data-[state=checked]:bg-ink data-[state=unchecked]:bg-border",
}

const THUMB_VARIANTS: Record<SwitchVariant, string> = {
  default:
    "absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-none data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-0",
  settings:
    "absolute left-[3px] top-[3px] h-[17px] w-[17px] rounded-full bg-white shadow-none data-[state=checked]:translate-x-[17px] data-[state=unchecked]:translate-x-0",
}

type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & {
  variant?: SwitchVariant
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, variant = "default", ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50",
      ROOT_VARIANTS[variant],
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block ring-0 transition-transform",
        THUMB_VARIANTS[variant]
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
