import Link from "next/link"
import { Plus } from "lucide-react"
import type { DeskHeroDraft } from "@/lib/queries/desk-activity"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import { cn } from "@/lib/utils"

type DeskHeroProps = {
  drafts: DeskHeroDraft[]
}

export function DeskHero({ drafts }: DeskHeroProps) {
  return (
    <div
      id="desk-hero"
      data-section="desk-hero"
      data-testid="desk-hero"
      className="DeskHero border-b-[0.5px] border-border bg-transparent px-9 py-7"
    >
      <div className="mb-4 flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">Open drafts</p>
      </div>

      <div className="flex gap-[10px] overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {drafts.map((draft) => (
          <Link
            key={draft.id}
            href={buildWritingRouteHref("/write", draft)}
            id={`desk-hero-draft-card-${draft.id}`}
            data-section="desk-hero-draft-card"
            data-testid="desk-hero-draft-card"
            className={cn(
              "DeskHeroDraftCard flex h-[170px] w-[220px] shrink-0 snap-start flex-col gap-2 rounded-lg border-[0.5px] border-border bg-white p-[14px] shadow-float transition-colors hover:border-ink-4/35",
              draft.isActive && "border-cursor/35 shadow-float-md",
            )}
          >
            <p className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-4",
              draft.isActive && "text-cursor",
            )}>
              {draft.statusLabel}
            </p>
            <p className="line-clamp-2 font-lora text-[15px] font-medium leading-[1.3] text-ink">{draft.title}</p>
            {draft.excerpt ? (
              <p className="line-clamp-2 text-[12px] leading-[1.55] text-ink-3">{draft.excerpt}</p>
            ) : null}
            <div className="mt-auto flex items-center justify-between border-t-[0.5px] border-border pt-2 text-[11px] text-ink-4">
              <span>{draft.updatedLabel}</span>
              <span>{draft.wordCount} words</span>
            </div>
          </Link>
        ))}

        <Link
          href="/write?new=1"
          id="desk-hero-draft-card-new"
          data-section="desk-hero-draft-card-new"
          data-testid="desk-hero-draft-card-new"
          className="DeskHeroDraftCardNew flex h-[170px] w-[220px] shrink-0 flex-col items-center justify-center gap-2 rounded-lg border-[0.5px] border-dashed border-border bg-white px-4 text-center text-[12px] text-ink-4 transition-colors hover:border-ink-3 hover:bg-muted hover:text-ink-2"
        >
          <p className="font-lora text-[17px] font-medium text-ink-3">Start a new note</p>
          <p className="text-[13px] leading-[1.6] text-ink-4">Keep the draft rail airy, with no top terracotta border on the cards.</p>
          <div className="mt-auto flex w-full items-center justify-between border-t-[0.5px] border-border pt-2 text-[12px] text-ink-4">
            <span>Draft space</span>
            <Plus className="h-[13px] w-[13px]" strokeWidth={1.5} />
          </div>
        </Link>
      </div>
    </div>
  )
}
