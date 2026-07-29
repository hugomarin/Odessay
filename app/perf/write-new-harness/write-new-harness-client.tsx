"use client"

import { useCallback, useState, type ComponentProps } from "react"

import { EditorShell } from "@/components/editor/editor-shell"

type DraftCounters = {
  materializations: number
  filesystemWrites: number
  manifestWrites: number
  catalogWrites: number
  syncEnqueues: number
  cloudWrites: number
}

const ZERO_COUNTERS: DraftCounters = {
  materializations: 0,
  filesystemWrites: 0,
  manifestWrites: 0,
  catalogWrites: 0,
  syncEnqueues: 0,
  cloudWrites: 0,
}

export function WriteNewHarnessClient() {
  const [counters, setCounters] = useState(ZERO_COUNTERS)
  const createHarnessDraft: NonNullable<
    ComponentProps<typeof EditorShell>["createDesktopDraftOverride"]
  > = useCallback(async (options = {}) => {
    setCounters((current) => ({
      materializations: current.materializations + 1,
      filesystemWrites: current.filesystemWrites + 1,
      manifestWrites: current.manifestWrites + 1,
      catalogWrites: current.catalogWrites + 1,
      syncEnqueues: current.syncEnqueues + 1,
      cloudWrites: current.cloudWrites,
    }))
    const now = new Date().toISOString()
    return {
      error: null,
      data: {
        id: options.writingId ?? crypto.randomUUID(),
        authorId: null,
        title: options.title?.trim() || "Untitled",
        content: {
          richText: options.initialBodyJson ?? { type: "doc", content: [] },
          markdown: null,
          plainText: options.initialBodyText ?? "",
          canonicalSource: "rich-text" as const,
        },
        slug: null,
        status: "draft" as const,
        artifactType: "general" as const,
        visibility: "private" as const,
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        contentUpdatedAt: now,
        metadataUpdatedAt: now,
      },
    }
  }, [])

  return (
    <>
      <EditorShell createDesktopDraftOverride={createHarnessDraft} />
      <output
        className="sr-only"
        data-testid="desktop-draft-lifecycle-counters"
        aria-live="polite"
      >
        {JSON.stringify(counters)}
      </output>
    </>
  )
}
