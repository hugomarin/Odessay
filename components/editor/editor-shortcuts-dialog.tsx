"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  EDITOR_SHORTCUT_HELP_SECTIONS,
  getEditorShortcutLabel,
  type ShortcutHelpItem,
} from "@/lib/editor/shortcuts"

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] rounded-[24px] border-[0.5px] border-border bg-sb p-0">
        <div className="px-8 py-7">
          <DialogHeader className="space-y-3 text-left">
            <DialogTitle className="text-[34px] leading-[1.05] tracking-[-0.03em]">
              Keyboard shortcuts
            </DialogTitle>
            <DialogDescription className="max-w-[560px] text-[15px] leading-7 text-ink-3">
              The desktop app exposes native menu shortcuts where available. The editor keeps the
              same core formatting map across runtimes and adapts only where the browser or OS would
              intercept the command first.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {EDITOR_SHORTCUT_HELP_SECTIONS.map((section) => (
              <section
                key={section.title}
                className="rounded-[18px] border-[0.5px] border-border bg-bg px-4 py-4"
              >
                <h2 className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-4">
                  {section.title}
                </h2>
                <div className="mt-4 space-y-3">
                  {section.items.map((item) => (
                    <div key={item.action} className="rounded-[12px] border-[0.5px] border-border/80 bg-sb px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[14px] text-ink">{item.description}</div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.07em] text-ink-4">
                            {availabilityLabel(item)}
                          </div>
                        </div>
                        <kbd className="shrink-0 rounded-[8px] border-[0.5px] border-border bg-bg px-2 py-1 text-[12px] text-ink-2">
                          {getEditorShortcutLabel(item.action) ?? "Menu only"}
                        </kbd>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
