"use client"

import { useState } from "react"
import { Check, Edit3, GripVertical, NotebookPen, Sparkles, SquareCheck, SquareCheckBig, Triangle } from "lucide-react"

import { cn } from "@/lib/utils"

export type MergeSourceDocument = { documentId: string; title: string }

export type MergeSectionSource = {
  documentId: string
  title: string
  lineRange: string
  quote: string
}

export type MergeSection = {
  id: string
  heading: string
  status: "single" | "conflict" | "agree"
  body: string
  provenance: string
  primarySourceDocumentId: string
  /** Populated only when `status === "conflict"` — the candidate whose text currently fills `body`. */
  suggestedSourceDocumentId?: string
  sources: MergeSectionSource[]
  /** "Además, incluir" candidates for `agree`/`single` sections with extra material from another source. */
  complementary: MergeSectionSource[]
}

export type MergeReviewToolResult = {
  destinationName: string
  sourceDocuments: MergeSourceDocument[]
  sections: MergeSection[]
}

function normalizedHeading(heading: string): string {
  return heading.trim().toLowerCase()
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter(Boolean))
}

function similarity(a: string, b: string): number {
  const setA = wordSet(a)
  const setB = wordSet(b)
  if (setA.size === 0 || setB.size === 0) return a.trim() === b.trim() ? 1 : 0
  let shared = 0
  for (const word of setA) if (setB.has(word)) shared += 1
  return shared / Math.max(setA.size, setB.size)
}

type ParsedBlock = { heading: string; body: string; startLine: number; endLine: number }

function parseSections(markdown: string): ParsedBlock[] {
  const lines = markdown.split("\n")
  const blocks: ParsedBlock[] = []
  let current: ParsedBlock | null = null
  lines.forEach((line, index) => {
    const match = /^(#{1,3})\s+(.*)$/.exec(line.trim())
    if (match) {
      if (current) { current.endLine = index; blocks.push(current) }
      current = { heading: match[2].trim(), body: "", startLine: index + 2, endLine: index + 2 }
      return
    }
    if (current && line.trim()) {
      current.body = current.body ? `${current.body} ${line.trim()}` : line.trim()
      current.endLine = index + 1
    }
  })
  if (current) blocks.push(current)
  return blocks
}

/**
 * Client-side mock for the Merge action (Fase H) — no backend merge tool
 * exists yet. Builds a plausible combined-document preview from the real
 * markdown of 2+ attached documents: union of headings (first-seen order),
 * per-heading similarity decides single/agree/conflict, and the longer body
 * wins as the conflict's suggested candidate (a measurable signal, not a
 * fabricated one). Wire this to a real merge tool when one exists.
 */
export function buildMergeMock(sources: { documentId: string; title: string; markdown: string }[]): MergeReviewToolResult {
  const perDocument = sources.map((source) => ({ ...source, blocks: parseSections(source.markdown) }))
  const seen = new Set<string>()
  const order: string[] = []
  for (const document of perDocument) {
    for (const block of document.blocks) {
      const key = normalizedHeading(block.heading)
      if (!seen.has(key)) { seen.add(key); order.push(key) }
    }
  }

  const sections: MergeSection[] = order.map((key, index) => {
    const contributions = perDocument
      .map((document) => ({ document, block: document.blocks.find((block) => normalizedHeading(block.heading) === key) }))
      .filter((entry): entry is { document: typeof perDocument[number]; block: ParsedBlock } => Boolean(entry.block))

    const heading = contributions[0].block.heading
    const toSource = (entry: typeof contributions[number]): MergeSectionSource => ({
      documentId: entry.document.documentId,
      title: entry.document.title,
      lineRange: entry.block.startLine === entry.block.endLine ? `línea ${entry.block.startLine}` : `líneas ${entry.block.startLine}-${entry.block.endLine}`,
      quote: entry.block.body,
    })

    if (contributions.length === 1) {
      const only = contributions[0]
      return {
        id: `section-${index}`,
        heading,
        status: "single",
        body: only.block.body,
        provenance: `Viene tal cual de ${only.document.title} · ${toSource(only).lineRange}`,
        primarySourceDocumentId: only.document.documentId,
        sources: [toSource(only)],
        complementary: [],
      }
    }

    const [first, second, ...rest] = contributions
    const score = similarity(first.block.body, second.block.body)
    const agree = score >= 0.55

    if (agree) {
      const extra = second.block.body.trim() !== first.block.body.trim() ? [toSource(second)] : []
      return {
        id: `section-${index}`,
        heading,
        status: "agree",
        body: first.block.body,
        provenance: extra.length > 0
          ? `Redacción unida de dos documentos que decían lo mismo · ${first.document.title} y ${second.document.title}`
          : `Viene tal cual de ${first.document.title} · ${toSource(first).lineRange}`,
        primarySourceDocumentId: first.document.documentId,
        sources: [toSource(first), toSource(second)],
        complementary: extra,
      }
    }

    const longer = second.block.body.length > first.block.body.length ? second : first
    const shorter = longer === first ? second : first
    return {
      id: `section-${index}`,
      heading,
      status: "conflict",
      body: longer.block.body,
      provenance: `Dos documentos dicen cosas distintas · ${first.document.title} y ${second.document.title}`,
      primarySourceDocumentId: longer.document.documentId,
      suggestedSourceDocumentId: longer.document.documentId,
      sources: [toSource(longer), toSource(shorter), ...rest.map(toSource)],
      complementary: [],
    }
  })

  return {
    destinationName: `${sources.map((source) => source.title.split(/[\s-]+/)[0]).join("-").toLowerCase() || "documento"}-unificado.md`,
    sourceDocuments: sources.map((source) => ({ documentId: source.documentId, title: source.title })),
    sections,
  }
}

export function MergeReviewBody({
  toolResult,
  onCreate,
}: {
  toolResult: MergeReviewToolResult
  onCreate: () => void
}) {
  const [sections, setSections] = useState(toolResult.sections)
  const [selectedId, setSelectedId] = useState(toolResult.sections[0]?.id ?? null)
  const [destinationName, setDestinationName] = useState(toolResult.destinationName)
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())

  const selected = sections.find((section) => section.id === selectedId) ?? null
  const pendingCount = sections.filter((section) => section.status === "conflict" && !confirmed.has(section.id)).length

  const chooseSource = (sectionId: string, documentId: string, quote: string) => {
    setSections((current) => current.map((section) => (
      section.id === sectionId ? { ...section, body: quote, primarySourceDocumentId: documentId } : section
    )))
  }

  const toggleComplementary = (sectionId: string, source: MergeSectionSource) => {
    setSections((current) => current.map((section) => {
      if (section.id !== sectionId) return section
      const included = section.body.includes(source.quote)
      return { ...section, body: included ? section.body : `${section.body} ${source.quote}` }
    }))
  }

  return (
    <div className="flex h-full flex-col px-4 pb-4">
      <div className="shrink-0 px-1 pb-3.5 pt-1">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.015em] text-ink">Un documento nuevo a partir de {toolResult.sourceDocuments.length}</h2>
          <span className="min-w-0 flex-1 text-[12.5px] leading-[1.3] text-ink-4">Este es el borrador que se va a crear. Los documentos originales quedan intactos.</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {toolResult.sourceDocuments.map((document) => (
            <span key={document.documentId} className="flex h-[26px] items-center gap-1.5 rounded-[7px] border-[0.5px] border-border bg-sb px-2.5 font-mono text-[12px] text-[#6B5F57]">
              {document.title}
            </span>
          ))}
          <Triangle className="h-3.5 w-3.5 rotate-90 text-[#CFC9C1]" strokeWidth={1.5} />
          <span className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-ink bg-sb px-2.5">
            <Sparkles className="h-[15px] w-[15px] text-[#5B5BD6]" strokeWidth={1.5} />
            <input
              value={destinationName}
              onChange={(event) => setDestinationName(event.target.value)}
              className="whitespace-nowrap bg-transparent font-mono text-[12.5px] font-medium text-ink outline-none"
              style={{ width: `${Math.max(destinationName.length, 8)}ch` }}
            />
            <Edit3 className="h-3.5 w-3.5 text-ink-5" strokeWidth={1.5} />
          </span>
          <span className="whitespace-nowrap text-[11.5px] text-ink-5">documento nuevo</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3.5">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-sb shadow-[0_1px_2px_rgba(35,24,15,0.06)]">
          <div className="flex h-[38px] shrink-0 items-center gap-2.5 border-b-[0.5px] border-[#F0EEEB] bg-[#FCFBFA] px-5">
            <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Borrador del documento combinado</span>
            <span className="text-[11px] text-ink-5">toca una sección para revisar sus fuentes</span>
          </div>
          <div className="od-scroll min-h-0 flex-1 overflow-y-auto">
            {sections.map((section, index) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setSelectedId(section.id)}
                className={cn(
                  "block w-full border-b-[0.5px] border-[#F0EEEB] px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-[#FCFBFA]",
                  section.id === selectedId && "bg-[#FAFAF8] shadow-[inset_3px_0_0_#1E1915]",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[11.5px] text-ink-5">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="min-w-0 flex-1 text-[17px] font-medium text-ink">{section.heading}</h3>
                  {section.status === "conflict" && !confirmed.has(section.id) ? (
                    <span className="flex h-[22px] shrink-0 items-center gap-1 rounded-[6px] bg-[#FAEDE4] px-2 text-[11px] font-medium text-[#96532C]">
                      <Sparkles className="h-[13px] w-[13px]" strokeWidth={1.5} /> Elige una versión
                    </span>
                  ) : null}
                  <GripVertical className="h-4 w-4 shrink-0 text-[#CFC9C1]" strokeWidth={1.5} />
                </div>
                <p className="ml-[26px] mt-2 text-[13.5px] leading-[1.7] text-ink-2">{section.body}</p>
                <p className="ml-[26px] mt-2.5 font-mono text-[11px] text-ink-5">{section.provenance}</p>
              </button>
            ))}
          </div>
        </div>

        {selected ? (
          <div className="flex w-[340px] shrink-0 flex-col overflow-hidden">
            <div className="shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Sección {sections.findIndex((section) => section.id === selected.id) + 1} · fuentes</p>
              <p className="mt-2 text-[16px] font-medium leading-[1.25] text-ink">{selected.heading}</p>
              <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-3">
                {selected.status === "conflict"
                  ? "Los documentos dan versiones distintas. Elige la que queda en el documento nuevo."
                  : "Toca una fuente para ver de dónde viene este texto."}
              </p>
            </div>
            <div className="od-scroll mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
              {selected.sources.map((source) => {
                const isChosen = selected.body === source.quote || (selected.status !== "conflict" && source.documentId === selected.primarySourceDocumentId)
                return (
                  <button
                    key={source.documentId}
                    type="button"
                    disabled={selected.status !== "conflict"}
                    onClick={() => chooseSource(selected.id, source.documentId, source.quote)}
                    className={cn(
                      "w-full rounded-[11px] border px-3.5 py-3 text-left",
                      isChosen ? "border-ink bg-sb" : "border-[#E4E1DC] bg-sb",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {selected.status === "conflict" ? (
                        isChosen
                          ? <SquareCheckBig className="h-[17px] w-[17px] shrink-0 fill-ink text-bg" strokeWidth={1.5} />
                          : <SquareCheck className="h-[17px] w-[17px] shrink-0 text-[#CFC9C1]" strokeWidth={1.5} />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[#6B5F57]">{source.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-5">{source.lineRange}</span>
                    </div>
                    <p className="ml-[26px] mt-2 text-[12.5px] italic leading-[1.55] text-ink">“{source.quote}”</p>
                    {selected.status === "conflict" && source.documentId === selected.suggestedSourceDocumentId ? (
                      <p className="ml-[26px] mt-1.5 flex items-center gap-1.5 text-[11.5px] text-[#6B5F57]">
                        <Sparkles className="h-[14px] w-[14px] shrink-0 text-[#5B5BD6]" strokeWidth={1.5} /> Tiene más detalle.
                      </p>
                    ) : null}
                  </button>
                )
              })}
              {selected.complementary.length > 0 ? (
                <>
                  <p className="pt-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Además, incluir</p>
                  {selected.complementary.map((source) => {
                    const included = selected.body.includes(source.quote)
                    return (
                      <button
                        key={source.documentId}
                        type="button"
                        onClick={() => toggleComplementary(selected.id, source)}
                        className="w-full rounded-[11px] border-[#E4E1DC] border bg-sb px-3.5 py-3 text-left"
                      >
                        <div className="flex items-center gap-2">
                          {included
                            ? <SquareCheckBig className="h-[17px] w-[17px] shrink-0 fill-ink text-bg" strokeWidth={1.5} />
                            : <SquareCheck className="h-[17px] w-[17px] shrink-0 text-[#CFC9C1]" strokeWidth={1.5} />}
                          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[#6B5F57]">{source.title}</span>
                          <span className="shrink-0 font-mono text-[11px] text-ink-5">{source.lineRange}</span>
                        </div>
                        <p className="ml-[26px] mt-2 text-[12.5px] italic leading-[1.55] text-ink">“{source.quote}”</p>
                      </button>
                    )
                  })}
                </>
              ) : null}
            </div>
            <div className="mt-3 shrink-0 space-y-1.5">
              <button
                type="button"
                onClick={() => setConfirmed((current) => new Set(current).add(selected.id))}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-[9px] bg-ink text-[13px] font-medium text-bg transition-colors hover:bg-[#3F3731]"
              >
                <Check className="h-4 w-4" strokeWidth={1.5} /> Confirmar la sección
              </button>
              <button type="button" className="flex h-8 w-full items-center justify-center text-[12.5px] text-[#6B5F57] transition-colors hover:bg-[#EDEBE7] hover:text-ink">
                Dejar las dos y decidir después
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3.5 flex shrink-0 items-center gap-2.5 px-1">
        <span className="flex-1 text-[12.5px] leading-[1.3] text-ink-4">
          {sections.length} sección(es) lista(s){pendingCount > 0 ? ` · ${pendingCount} espera(n) que elijas una versión` : ""}
        </span>
        <button
          type="button"
          disabled
          title="Vista previa — todavía no crea el documento (no hay un tool de merge real)"
          onClick={onCreate}
          className="flex h-9 items-center gap-2 rounded-[9px] bg-ink px-4 text-[13px] font-medium text-bg opacity-50"
        >
          <NotebookPen className="h-4 w-4" strokeWidth={1.5} /> Crear el documento
        </button>
      </div>
    </div>
  )
}
