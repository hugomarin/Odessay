"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"

import { WritingPreviewModal } from "@/components/desk/writing-preview-modal"
import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import type { DeskActivityRow } from "@/lib/queries/desk-activity"
import type { ArtifactType } from "@/lib/writings/artifact-type"
import type { WritingStatus } from "@/lib/writings/status"

const TITLES = [
  "Leccion 5 - Evaluacion de prompts",
  "Omega",
  "Beta",
  "05-Implementing a client",
  "Mapa-razonamiento-y-desarrollo-Leccion2",
  "Alpha",
  "transcript-llamada-2026-07-24",
  "Brief for the model comparison",
  "Narratif tone guide",
  "Publishing checklist",
]

const STATUSES: WritingStatus[] = ["draft", "draft", "draft", "in_review", "done", "exploring", "new", "draft", "done", "draft"]
const TYPES: ArtifactType[] = ["general", "general", "general", "skill", "general", "prompt", "general", "template", "skill", "general"]

const BODY = [
  "In the previous lesson we repeated one phrase to exhaustion: any technique we apply is only known to work once it is measured. And every time we improved the meal-plan prompt — by making it clear and direct, by adding guides, by asking it to reason step by step — we said the same thing: this should raise the score. Always conditional. We never saw the score.",
  "This lesson makes it real.",
  "We also closed with an idea that now needs developing: after writing a prompt you almost always take one of three paths, and the third one — putting it through an evaluation that scores it — is the only one that gives you real confidence.",
]

function bodyJson() {
  return {
    type: "doc",
    content: BODY.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  }
}

function makeWriting(index: number): LocalWriting {
  const id = `preview-fixture-${index + 1}`
  const created = new Date(Date.UTC(2026, 7, 5 - index)).toISOString()
  return {
    id,
    author_id: "harness-user",
    title: TITLES[index],
    canonical_path: `/Users/hugomarin/Documents/Tutoria/${TITLES[index]}.md`,
    body_json: bodyJson(),
    body_text: BODY.join("\n\n"),
    status: STATUSES[index],
    artifact_type: TYPES[index],
    visibility: "private",
    version: 1,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: created,
    updated_at: created,
    content_updated_at: created,
    local_updated_at: Date.now(),
  }
}

function toRow(writing: LocalWriting, index: number): DeskActivityRow {
  return {
    id: writing.id,
    title: TITLES[index],
    excerpt: BODY[0].slice(0, 110),
    localPath: writing.canonical_path ?? null,
    stateLabel: STATUSES[index].replace("in_review", "In Review").replace(/^./, (c) => c.toUpperCase()),
    stateTone: STATUSES[index],
    documentState: "synced",
    artifactType: TYPES[index],
    recipientPreviews: [],
    dateLabel: `${index + 1}d`,
    isNew: false,
    destinationHref: `/write/${writing.id}`,
    workspaceSlug: "Tutoria",
    workspaceName: "Tutoria",
  }
}

export function PreviewOverlayHarnessClient() {
  const params = useSearchParams()
  const withLink = params.get("link") === "generated"

  const [ready, setReady] = React.useState(false)
  const [index, setIndex] = React.useState(0)

  const writings = React.useMemo(() => TITLES.map((_, position) => makeWriting(position)), [])
  const rows = React.useMemo(() => writings.map(toRow), [writings])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const writing of writings) {
        await localDB.writings.save(writing)
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [writings])

  if (!ready) {
    return <main data-testid="preview-harness-seeding" className="min-h-screen bg-bg" />
  }

  return (
    <main data-testid="preview-harness" className="min-h-screen bg-bg">
      <WritingPreviewModal
        open
        rows={rows}
        currentIndex={index}
        collectionOptions={[]}
        collectionIdsByWritingId={{}}
        onOpenChange={() => {}}
        onIndexChange={setIndex}
        onToggleCollection={async () => {}}
        onCreateCollection={async () => {}}
        onStatusChange={async () => {}}
        onArtifactTypeChange={async () => {}}
        workspaceOptions={[{ slug: "Tutoria", name: "Tutoria" }]}
        workspaceAvailable
        onAssignWorkspace={() => {}}
        onUnassignWorkspace={() => {}}
        onCreateWorkspace={() => {}}
        onTitleChange={async () => {}}
        onOpenFullWriting={() => {}}
        onExportMarkdown={() => {}}
        onExportDocument={async () => {}}
        onOpenWebAction={async () => {}}
        onDelete={async () => {}}
        // `?link=generated` captures the sharing card's second state without
        // reaching the network for a token.
        key={withLink ? "with-link" : "no-link"}
      />
    </main>
  )
}
