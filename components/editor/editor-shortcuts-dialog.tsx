"use client"

import { DisplayModal } from "@/components/ui/display-modal"
import {
  EDITOR_SHORTCUT_HELP_SECTIONS,
  getEditorShortcutLabel,
  type ShortcutHelpItem,
} from "@/lib/editor/shortcuts"

/**
 * Keyboard shortcuts — the inventory's display modal (docs/design/overlays.md):
 * Lora 34/500 title over a three-column grid of `kbd` rows.
 */

function availabilityLabel(item: ShortcutHelpItem) {
  if (item.availability === "desktop") {
    return "Desktop"
  }

  if (item.availability === "web") {
    return "Web"
  }

  return "Web + Desktop"
}

export function EditorShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DisplayModal
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="The desktop app exposes native menu shortcuts where available. The editor keeps the same core formatting map across runtimes and adapts only where the browser or OS would intercept the command first."
    >
      <div className="grid gap-6 md:grid-cols-3">
        {EDITOR_SHORTCUT_HELP_SECTIONS.map((section) => (
          <section key={section.title} className="rounded-xl border-[0.5px] border-border bg-bg px-3.5 py-3.5">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.13em] text-ink-4">
              {section.title}
            </h2>
            <div className="mt-3 space-y-1.5">
              {section.items.map((item) => (
                <div
                  key={item.action}
                  className="flex items-start justify-between gap-3 rounded-lg bg-sb px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink">{item.description}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-[0.09em] text-ink-5">
                      {availabilityLabel(item)}
                    </div>
                  </div>
                  <kbd className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-ink-3">
                    {getEditorShortcutLabel(item.action) ?? "Menu only"}
                  </kbd>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DisplayModal>
  )
}
