"use client"

import { useState } from "react"
import { Switch } from "@/components/ui/switch"

const HARNESS_ROWS = [
  { label: "Official off", variant: "default" as const, initial: false },
  { label: "Official on", variant: "default" as const, initial: true },
  { label: "Legacy alias off", variant: "settings" as const, initial: false },
  { label: "Legacy alias on", variant: "settings" as const, initial: true },
]

function HarnessSwitch({
  label,
  initial,
  variant,
}: {
  label: string
  initial: boolean
  variant: "default" | "settings"
}) {
  const [checked, setChecked] = useState(initial)

  return (
    <div className="flex items-center justify-between rounded-[12px] border-[0.5px] border-border bg-sb px-4 py-3">
      <div>
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="mt-1 text-[11px] text-ink-4">
          variant: {variant} · state: {checked ? "on" : "off"}
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={setChecked} variant={variant} />
    </div>
  )
}

export default function SwitchHarnessPage() {
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    return null
  }

  return (
    <main className="min-h-screen bg-bg px-6 py-10">
      <div className="mx-auto max-w-[640px]">
        <h1 className="font-lora text-[28px] font-medium text-ink">Switch harness</h1>
        <p className="mt-2 text-[13px] text-ink-4">
          Validate the canonical switch shape before adjusting screen-specific flows.
        </p>

        <div className="mt-6 space-y-3">
          {HARNESS_ROWS.map((row) => (
            <HarnessSwitch
              key={`${row.variant}-${row.label}`}
              label={row.label}
              initial={row.initial}
              variant={row.variant}
            />
          ))}
        </div>
      </div>
    </main>
  )
}
