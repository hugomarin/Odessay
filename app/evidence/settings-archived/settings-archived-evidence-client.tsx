"use client"

import { useMemo, useReducer, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { ArchivedWritingsList, type ArchivedWritingsService } from "@/components/settings/archived-writings-list"
import { SettingsNav } from "@/components/settings/settings-nav"
import type { WritingRecord, WritingSummary } from "@/lib/services/contracts/document-service"

const archivedAt = "2026-07-29T12:00:00.000Z"

function fixture(index: number): WritingSummary {
  return {
    id: `archive-${index}`,
    authorId: "evidence-author",
    title: index === 1 ? "Novel notes" : index === 2 ? "Research fragments" : `Archived writing ${index}`,
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
      if (!target) return { data: null, error: { code: "NOT_FOUND", message: "Archived writing not found", retryable: false } }
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
      if (!target) return { data: null, error: { code: "NOT_FOUND", message: "Archived writing not found", retryable: false } }
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

  return <main data-testid="settings-archived-evidence" className="min-h-screen bg-bg px-12 py-10 text-ink">
    <div className="mx-auto grid max-w-[1120px] grid-cols-[190px_1fr] gap-14">
      <aside>
        <h1 className="mb-7 font-lora text-[24px]">Settings</h1>
        <SettingsNav />
      </aside>
      <section className="pt-1">
        <h2 className="font-lora text-[28px]">Archived writings</h2>
        <p className="mb-7 mt-1 text-[13px] text-ink-4">Download, restore, or permanently delete soft-deleted writings.</p>
        <ArchivedWritingsList service={service} />
      </section>
    </div>
  </main>
}
