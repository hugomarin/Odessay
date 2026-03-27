import { FileText } from "lucide-react"
import { cn } from "@/lib/utils"

type SidebarListPanelProps = {
  open: boolean
}

const COLLECTION_SECTIONS = [
  { label: "All writings", meta: "42" },
  { label: "Uncategorized", meta: "7" },
  { label: "Reflections", meta: "11" },
  { label: "Letters", meta: "9" },
]

export function SidebarListPanel({ open }: SidebarListPanelProps) {
  return (
    <aside
      id="sidebar-list-panel"
      data-section="sidebar-list-panel"
      data-testid="sidebar-list-panel"
      aria-hidden={!open}
      className={cn(
        "overflow-hidden border-r-[0.5px] border-border bg-sb transition-[width] duration-[320ms] ease-layout",
        open ? "w-[240px]" : "w-0 border-r-0",
      )}
    >
      <div className="h-full w-[240px]">
        <header className="border-b-[0.5px] border-border px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Collections</p>
        </header>

        <div className="px-2 py-3">
          {COLLECTION_SECTIONS.map((section) => (
            <button
              key={section.label}
              type="button"
              className="flex w-full items-center justify-between rounded-md px-2 py-[9px] text-left text-[13px] text-ink-3 transition-colors hover:bg-muted/70 hover:text-ink"
            >
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4" strokeWidth={1.5} />
                <span>{section.label}</span>
              </span>
              <span className="text-[11px] text-ink-4">{section.meta}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
