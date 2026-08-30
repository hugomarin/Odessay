"use client"

import Link from "next/link"
import { Plus } from "lucide-react"

import { ViewHeader, VIEW_HEADER_ACTION_CLASS } from "@/components/navigation/view-header"

/**
 * Desk header — the reference every other view's header now follows, so the
 * geometry itself lives in `ViewHeader`.
 *
 * **New Artifact is the only action here.** Import was kept as a divergence in
 * ODE-430 and is now removed from the header, which carries a single primary
 * action. `ImportWritingDialog` stays mounted in the Desk client, so giving it
 * a trigger again is a one-line change.
 */
export function DeskHeader() {
  return (
    <ViewHeader
      sectionId="desk-header"
      testId="desk-header"
      title="Desk"
      subtitle="Artifact activity, shared drafts, and collection context."
      actions={
        <Link href="/write?new=1" data-testid="desk-new-artifact" className={VIEW_HEADER_ACTION_CLASS}>
          <Plus className="h-[17px] w-[17px]" strokeWidth={1.5} />
          New Artifact
        </Link>
      }
    />
  )
}
