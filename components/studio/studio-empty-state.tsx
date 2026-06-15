"use client"

import Link from "next/link"
import { FileSearch, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

export function StudioEmptyState() {
  const openArtifactPicker = () => {
    window.dispatchEvent(new Event("odessay:open-search"))
  }

  return (
    <div
      id="studio-empty-state"
      data-section="studio-empty-state"
      data-testid="studio-empty-state"
      className="StudioEmptyState flex min-h-[420px] flex-col items-center justify-center gap-5 px-6 text-center"
    >
      <p className="max-w-[340px] font-lora text-[17px] italic leading-[1.7] text-ink-3">
        No artifacts are open in Studio.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={openArtifactPicker}
          className="h-8 px-[14px] text-[13px]"
        >
          <FileSearch className="h-[14px] w-[14px]" strokeWidth={1.5} />
          Open artifact
        </Button>
        <Button
          asChild
          className="h-8 bg-cursor px-[14px] text-[13px] text-white hover:bg-cursor/90"
        >
          <Link href="/write?new=1">
            <Plus className="h-[14px] w-[14px]" strokeWidth={1.5} />
            New artifact
          </Link>
        </Button>
      </div>
    </div>
  )
}
