"use client"

import Link from "next/link"
import { ArrowUpRight, Circle } from "lucide-react"
import { StudioEmptyState } from "@/components/studio/studio-empty-state"
import { useStudioSessionStore } from "@/lib/stores/studio-session-store"
import { cn } from "@/lib/utils"

function getSaveLabel(saveState: string, hasPendingSync: boolean) {
  if (hasPendingSync) {
    return "Pending sync"
  }

  if (saveState === "saving") {
    return "Saving"
  }

  if (saveState === "error") {
    return "Needs attention"
  }

  return "Saved"
}

export function StudioPage() {
  const { activeArtifactId, artifacts } = useStudioSessionStore()

  return (
    <section id="studio" data-page="studio" className="Studio flex min-h-screen flex-col bg-bg">
      <div
        id="studio-topbar"
        data-section="studio-topbar"
        data-testid="studio-topbar"
        className="StudioTopbar flex h-[70px] items-center justify-between gap-4 border-b-[0.5px] border-border bg-[color-mix(in_srgb,hsl(var(--sb))_84%,hsl(var(--bg)))] px-5 sm:px-9"
      >
        <div className="flex min-w-0 items-baseline gap-3">
          <p className="shrink-0 text-[24px] font-medium tracking-[-0.03em] text-ink">Studio</p>
          <p className="truncate text-[13px] text-ink-4">Open artifacts from this session.</p>
        </div>
      </div>

      <div
        id="studio-content"
        data-section="studio-content"
        data-testid="studio-content"
        className="StudioContent flex-1 px-5 py-8 sm:px-9"
      >
        {artifacts.length === 0 ? (
          <StudioEmptyState />
        ) : (
          <div
            id="studio-open-artifacts"
            data-section="studio-open-artifacts"
            data-testid="studio-open-artifacts"
            className="StudioOpenArtifacts mx-auto flex max-w-[760px] flex-col gap-2"
          >
            {artifacts.map((artifact) => {
              const isActive = artifact.id === activeArtifactId
              return (
                <Link
                  key={artifact.id}
                  href={artifact.href}
                  className={cn(
                    "StudioArtifactRow flex min-h-[68px] items-center justify-between gap-4 rounded-[10px] border-[0.5px] border-border bg-sb px-4 py-3 shadow-float transition-[background-color,border-color] duration-[180ms] hover:border-[hsl(var(--cursor))] hover:bg-[hsl(22_55%_97%)]",
                    isActive ? "border-[hsl(var(--cursor))] bg-[hsl(22_55%_97%)]" : "",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate font-lora text-[16px] font-medium text-ink">
                      {artifact.title}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-4">
                      <Circle
                        className={cn("h-[6px] w-[6px] fill-current", isActive ? "text-cursor" : "text-ink-4")}
                        strokeWidth={1.5}
                      />
                      {getSaveLabel(artifact.saveState, artifact.hasPendingSync)}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-ink-3">
                    Open
                    <ArrowUpRight className="h-[13px] w-[13px]" strokeWidth={1.5} />
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
