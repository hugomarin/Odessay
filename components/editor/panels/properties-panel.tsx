"use client"

import { X } from "lucide-react"
import type { WritingStatus } from "@/lib/local-db/schema"
import type { TextMetrics } from "@/lib/editor/text-metrics"
import { cn } from "@/lib/utils"

type PropertiesPanelProps = {
  status: WritingStatus
  metrics: TextMetrics
  onStatusChange: (next: WritingStatus) => void
  onClose: () => void
}

const STATUS_OPTIONS: Array<{ value: WritingStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "finished", label: "Done" },
]

export function PropertiesPanel({
  status,
  metrics,
  onStatusChange,
  onClose,
}: PropertiesPanelProps) {
  return (
    <aside
      id="editor-panel-properties"
      data-section="editor-panel-properties"
      data-testid="editor-panel-properties"
      className="EditorPanelProperties h-full w-[248px] border-l-[0.5px] border-border bg-sb"
    >
      <div className="flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Properties</p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
          aria-label="Close properties panel"
        >
          <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
        </button>
      </div>

      <div className="space-y-5 p-4">
        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Status</p>
          <div className="grid grid-cols-2 gap-2">
            {STATUS_OPTIONS.map((option) => {
              const active = status === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onStatusChange(option.value)}
                  className={cn(
                    "h-8 rounded-md border-[0.5px] text-[12px] font-medium transition-colors",
                    active
                      ? "border-ink bg-ink text-bg"
                      : "border-border bg-bg text-ink-3 hover:bg-muted hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Visibility</p>
          <div className="rounded-md border-[0.5px] border-border bg-bg px-3 py-2">
            <p className="text-[12px] font-medium text-ink">Private</p>
            <p className="mt-1 text-[11px] text-ink-4">
              Visibility remains private in this phase.
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Info</p>
          <dl className="space-y-2 rounded-lg border-[0.5px] border-border bg-bg p-3">
            <MetricRow label="Words" value={metrics.words.toLocaleString()} />
            <MetricRow label="Characters" value={metrics.characters.toLocaleString()} />
            <MetricRow label="Sentences" value={metrics.sentences.toLocaleString()} />
            <MetricRow label="Reading time" value={`${metrics.readingTimeMinutes} min`} />
            <MetricRow label="Pages" value={metrics.pages.toFixed(1)} />
          </dl>
        </section>
      </div>
    </aside>
  )
}

type MetricRowProps = {
  label: string
  value: string
}

function MetricRow({ label, value }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <dt className="text-ink-4">{label}</dt>
      <dd className="font-medium text-ink-2">{value}</dd>
    </div>
  )
}
