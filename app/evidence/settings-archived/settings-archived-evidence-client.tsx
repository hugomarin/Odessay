"use client"

import { useMemo, useReducer, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { ArchivedWritingsList, type ArchivedWritingsService } from "@/components/settings/archived-writings-list"
import { SettingsShell } from "@/components/settings/settings-shell"
import type { WritingRecord, WritingSummary } from "@/lib/services/contracts/document-service"

const archivedAt = "2026-07-29T12:00:00.000Z"

function fixture(index: number): WritingSummary {
  return {
    id: `archive-${index}`,
    authorId: "evidence-author",
    title: index === 1 ? "Novel notes" : index === 2 ? "Research fragments" : `Archived artifact ${index}`,
    excerpt: null,
    slug: null,
    status: "draft",
    artifactType: "general",
    visibility: "private",
    parentId: null,
    correspondenceId: null,
    version: index,
    deletedAt: archivedAt,
    createdAt: archivedAt,
    updatedAt: archivedAt,
    archiveState: "archived",
  }
}

function restored(row: WritingSummary, updatedAt: string): WritingRecord {
  return {
    ...row,
    content: { markdown: "", richText: null, plainText: "", canonicalSource: "pending-document-contract" },
    version: row.version + 1,
    deletedAt: null,
    updatedAt,
  }
}

export function SettingsArchivedEvidenceClient() {
  const searchParams = useSearchParams()
  const initialRows = searchParams.get("state") === "empty" ? [] : [fixture(1), fixture(2), ...Array.from({ length: 25 }, (_, index) => fixture(index + 3))]
  const rowsRef = useRef<WritingSummary[]>(initialRows)
  const [, refresh] = useReducer((value) => value + 1, 0)

  const service = useMemo<ArchivedWritingsService>(() => ({
    async listWritings({ limit = 25, offset = 0 } = {}) {
      return { data: rowsRef.current.slice(offset, offset + limit), error: null }
    },
    async restoreWriting(input) {
      const target = rowsRef.current.find((row) => row.id === input.writingId)
      if (!target) return { data: null, error: { code: "NOT_FOUND", message: "Archived artifact not found", retryable: false } }
      rowsRef.current = rowsRef.current.filter((row) => row.id !== input.writingId)
      refresh()
      return { data: restored(target, input.updatedAt), error: null }
    },
    async permanentlyDeleteWriting(input) {
      rowsRef.current = rowsRef.current.filter((row) => row.id !== input.writingId)
      refresh()
      return { data: undefined, error: null }
    },
    async downloadWriting(input) {
      const target = rowsRef.current.find((row) => row.id === input.writingId)
      if (!target) return { data: null, error: { code: "NOT_FOUND", message: "Archived artifact not found", retryable: false } }
      return {
        data: {
          writingId: target.id,
          format: "markdown",
          fileName: `${target.title}.md`,
          mimeType: "text/markdown",
          bytes: new TextEncoder().encode(`# ${target.title}\n\nArchived evidence.`),
        },
        error: null,
      }
    },
  }), [])

  return <main data-testid="settings-archived-evidence" className="flex h-screen min-h-0 flex-col bg-bg pt-2.5 text-ink">
    <SettingsShell section="/settings/archived">
      <ArchivedWritingsList service={service} />
    </SettingsShell>
  </main>
}
