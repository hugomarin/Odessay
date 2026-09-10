/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MergeReviewBody } from "@/components/agent/workspace-agent-review-merge"
import type { MergeReviewToolResult, MergeSection } from "@/lib/agent/workspace-agent-analysis"

const scopeA = {
  documentId: "doc-a",
  title: "Plan A",
  evidenceId: "merge:doc-a:scope",
  documentVersion: "v1@100",
  contentHash: null,
  lineRange: "line 3",
  quote: "The project starts in May.",
}

const scopeB = {
  documentId: "doc-b",
  title: "Plan B",
  evidenceId: "merge:doc-b:scope",
  documentVersion: "v2@200",
  contentHash: null,
  lineRange: "line 3",
  quote: "The project starts in June.",
}

const toolResult: MergeReviewToolResult = {
  destinationName: "plan-unificado.md",
  sourceDocuments: [
    { documentId: "doc-a", title: "Plan A", documentVersion: "v1@100", contentHash: null },
    { documentId: "doc-b", title: "Plan B", documentVersion: "v2@200", contentHash: null },
  ],
  sections: [
    {
      id: "merge-section:scope",
      heading: "Scope",
      headingLevel: 1,
      status: "conflict",
      body: "",
      provenance: "Síntesis contradictory · Plan A, Plan B · evidence merge:doc-a:scope, merge:doc-b:scope",
      primarySourceDocumentId: null,
      suggestedSourceDocumentId: null,
      suggestedSourceReason: null,
      rationale: "The dates differ materially.",
      confidence: "high",
      evidenceIds: [scopeA.evidenceId, scopeB.evidenceId],
      sources: [scopeA, scopeB],
      complementary: [],
    },
    {
      id: "merge-section:notes",
      heading: "Notes",
      headingLevel: 1,
      status: "unified",
      body: "Keep the checklist and ask the editor.",
      provenance: "Síntesis complementary · Plan A, Plan B · evidence merge:doc-a:notes, merge:doc-b:notes",
      primarySourceDocumentId: null,
      suggestedSourceDocumentId: null,
      suggestedSourceReason: null,
      rationale: "The notes are compatible.",
      confidence: "high",
      evidenceIds: ["merge:doc-a:notes", "merge:doc-b:notes"],
      sources: [
        { ...scopeA, evidenceId: "merge:doc-a:notes", lineRange: "line 7", quote: "Keep the checklist." },
        { ...scopeB, evidenceId: "merge:doc-b:notes", lineRange: "line 7", quote: "Ask the editor." },
      ],
      complementary: [],
    },
  ],
  status: "complete",
  coverage: "complete",
  rounds: 1,
  evidence: [],
  usage: null,
  executionReceipt: null,
  error: null,
  sourceSnapshots: {
    "doc-a": { documentVersion: "v1@100", contentHash: null },
    "doc-b": { documentVersion: "v2@200", contentHash: null },
  },
}

let container: HTMLDivElement
let root: Root | null = null

function buttonContaining(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`)
  return button
}

function render(onCreate: (destinationName: string, sections: MergeSection[]) => void) {
  act(() => {
    root?.render(<MergeReviewBody toolResult={toolResult} onCreate={onCreate} />)
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

describe("MergeReviewBody", () => {
  it("requires an explicit decision before enabling document creation", () => {
    const onCreate = vi.fn()
    render(onCreate)

    expect(buttonContaining("Crear el documento").disabled).toBe(true)

    act(() => {
      buttonContaining("Dejar ambas y aceptar el conflicto").click()
    })

    const create = buttonContaining("Crear el documento")
    expect(create.disabled).toBe(false)
    act(() => create.click())

    expect(onCreate).toHaveBeenCalledTimes(1)
    const sections = onCreate.mock.calls[0]?.[1] as MergeSection[]
    expect(sections[0]).toMatchObject({
      primarySourceDocumentId: null,
      body: expect.stringContaining("Conflicto material aceptado sin resolver."),
    })
  })

  it("passes the exact selected source when a material conflict is resolved", () => {
    const onCreate = vi.fn()
    render(onCreate)

    act(() => {
      buttonContaining("The project starts in May.").click()
    })
    act(() => {
      buttonContaining("Confirmar la fuente elegida").click()
    })
    act(() => {
      buttonContaining("Crear el documento").click()
    })

    const sections = onCreate.mock.calls[0]?.[1] as MergeSection[]
    expect(sections[0]).toMatchObject({
      primarySourceDocumentId: "doc-a",
      body: "The project starts in May.",
    })
  })
})
