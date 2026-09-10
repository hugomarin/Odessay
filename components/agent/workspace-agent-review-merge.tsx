"use client"

import { useMemo, useState } from "react"
import { Check, Edit3, GripVertical, NotebookPen, Sparkles, SquareCheck, SquareCheckBig, Triangle } from "lucide-react"

import {
  buildAcceptedUnresolvedMergeBody,
  type MergeReviewToolResult,
  type MergeSection,
  type MergeSectionSource,
} from "@/lib/agent/workspace-agent-analysis"
import { cn } from "@/lib/utils"

export type { MergeReviewToolResult, MergeSection, MergeSectionSource }

type MergeDecision = "resolved" | "accepted-unresolved"

function statusLabel(section: MergeSection, decision: MergeDecision | undefined): string {
  if (section.status === "conflict") return decision === "accepted-unresolved" ? "Aceptado sin resolver" : decision === "resolved" ? "Resuelto" : "Conflicto material"
  if (section.status === "unified") return "Unificado"
  if (section.status === "complementary") return "Complementario"
  if (section.status === "irrelevant") return "Omitido"
  return "Necesita contexto"
}

function statusClass(section: MergeSection, decision: MergeDecision | undefined): string {
  if (section.status === "conflict" && !decision) return "bg-[#FAEDE4] text-[#96532C]"
  if (section.status === "insufficient_evidence") return "bg-[#FAEDE4] text-[#96532C]"
  if (section.status === "conflict" && decision === "accepted-unresolved") return "bg-[#F2EEE8] text-[#6B5F57]"
  return "bg-[#E9F2E9] text-[#3E6947]"
}

function sourceIsChosen(section: MergeSection, source: MergeSectionSource): boolean {
  return section.primarySourceDocumentId === source.documentId && section.body === source.quote
}

export function MergeReviewBody({
  toolResult,
  busy = false,
  onCreate,
}: {
  toolResult: MergeReviewToolResult
  busy?: boolean
  onCreate: (destinationName: string, sections: MergeSection[]) => void
}) {
  const [sections, setSections] = useState<MergeSection[]>(toolResult.sections)
  const [selectedId, setSelectedId] = useState(toolResult.sections.find((section) => section.status === "conflict")?.id ?? toolResult.sections[0]?.id ?? null)
  const [destinationName, setDestinationName] = useState(toolResult.destinationName)
  const [decisions, setDecisions] = useState<Map<string, MergeDecision>>(new Map())

  const selected = sections.find((section) => section.id === selectedId) ?? null
  const pendingConflicts = sections.filter((section) => section.status === "conflict" && !decisions.has(section.id)).length
  const hasInsufficientEvidence = sections.some((section) => section.status === "insufficient_evidence")
  const destinationIsValid = destinationName.trim().length > 0 && !destinationName.includes("/") && !destinationName.includes("\\")
  const canCreate = toolResult.status === "complete"
    && toolResult.coverage === "complete"
    && !toolResult.error
    && sections.length > 0
    && pendingConflicts === 0
    && !hasInsufficientEvidence
    && !busy
    && destinationIsValid

  const blockedReason = useMemo(() => {
    if (toolResult.status !== "complete" || toolResult.coverage !== "complete") return "La síntesis no tiene cobertura completa; vuelve a intentarlo."
    if (toolResult.error) return toolResult.error.message
    if (hasInsufficientEvidence) return "Una o más secciones necesitan evidencia adicional."
    if (pendingConflicts > 0) return `Revisa ${pendingConflicts} conflicto(s) material(es) antes de crear el documento.`
    if (!destinationIsValid) return "Escribe un nombre de archivo .md válido."
    return null
  }, [destinationIsValid, hasInsufficientEvidence, pendingConflicts, toolResult.coverage, toolResult.error, toolResult.status])

  const chooseSource = (sectionId: string, source: MergeSectionSource) => {
    setSections((current) => current.map((section) => (
      section.id === sectionId
        ? { ...section, body: source.quote, primarySourceDocumentId: source.documentId }
        : section
    )))
    setDecisions((current) => {
      const next = new Map(current)
      next.delete(sectionId)
      return next
    })
  }

  const confirmSection = () => {
    if (!selected || selected.status !== "conflict" || !selected.primarySourceDocumentId || !selected.body.trim()) return
    setDecisions((current) => new Map(current).set(selected.id, "resolved"))
  }

  const acceptUnresolved = () => {
    if (!selected || selected.status !== "conflict") return
    setSections((current) => current.map((section) => (
      section.id === selected.id
        ? { ...section, body: buildAcceptedUnresolvedMergeBody(section), primarySourceDocumentId: null }
        : section
    )))
    setDecisions((current) => new Map(current).set(selected.id, "accepted-unresolved"))
  }

  return (
    <div className="flex h-full flex-col px-4 pb-4">
      <div className="shrink-0 px-1 pb-3.5 pt-1">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.015em] text-ink">Un documento nuevo a partir de {toolResult.sourceDocuments.length}</h2>
          <span className="min-w-0 flex-1 text-[12.5px] leading-[1.3] text-ink-4">La síntesis fue revisada con evidencia. Los documentos originales quedan intactos.</span>
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
              aria-label="Nombre del documento combinado"
              value={destinationName}
              onChange={(event) => setDestinationName(event.target.value)}
              className="whitespace-nowrap bg-transparent font-mono text-[12.5px] font-medium text-ink outline-none"
              style={{ width: `${Math.max(destinationName.length, 8)}ch` }}
            />
            <Edit3 className="h-3.5 w-3.5 text-ink-5" strokeWidth={1.5} />
          </span>
          <span className="whitespace-nowrap text-[11.5px] text-ink-5">documento nuevo</span>
        </div>
        {toolResult.usage ? (
          <p className="mt-2 font-mono text-[10.5px] text-ink-5" data-testid="workspace-agent-merge-usage">
            {toolResult.usage.model} · {toolResult.rounds} ronda(s) · {toolResult.usage.totalTokens ?? "?"} tokens
          </p>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 gap-3.5">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-sb shadow-[0_1px_2px_rgba(35,24,15,0.06)]">
          <div className="flex h-[38px] shrink-0 items-center gap-2.5 border-b-[0.5px] border-[#F0EEEB] bg-[#FCFBFA] px-5">
            <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Borrador del documento combinado</span>
            <span className="text-[11px] text-ink-5">toca una sección para revisar sus fuentes</span>
          </div>
          <div className="od-scroll min-h-0 flex-1 overflow-y-auto">
            {sections.map((section, index) => {
              const decision = decisions.get(section.id)
              return (
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
                    <span className={cn("shrink-0 rounded-[6px] px-2 py-1 text-[10.5px] font-medium", statusClass(section, decision))}>
                      {statusLabel(section, decision)}
                    </span>
                    <GripVertical className="h-4 w-4 shrink-0 text-[#CFC9C1]" strokeWidth={1.5} />
                  </div>
                  {section.body ? <p className="ml-[26px] mt-2 whitespace-pre-wrap text-[13.5px] leading-[1.7] text-ink-2">{section.body}</p> : null}
                  <p className="ml-[26px] mt-2.5 font-mono text-[11px] text-ink-5">{section.provenance}</p>
                </button>
              )
            })}
          </div>
        </div>

        {selected ? (
          <div className="flex w-[340px] shrink-0 flex-col overflow-hidden">
            <div className="shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Sección {sections.findIndex((section) => section.id === selected.id) + 1} · fuentes</p>
              <p className="mt-2 text-[16px] font-medium leading-[1.25] text-ink">{selected.heading}</p>
              <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-3">
                {selected.status === "conflict"
                  ? "Los documentos dan versiones distintas. Elige una fuente o acepta explícitamente mantener ambas."
                  : selected.status === "insufficient_evidence"
                    ? "La evidencia disponible no permite crear esta sección de forma segura."
                    : "La síntesis muestra el texto generado y las fuentes exactas que la respaldan."}
              </p>
              {selected.rationale ? <p className="mt-2 rounded-[8px] bg-[#F7F4F0] px-2.5 py-2 text-[11.5px] leading-[1.5] text-ink-3">{selected.rationale}</p> : null}
              <p className="mt-2 font-mono text-[10.5px] text-ink-5">confianza {selected.confidence} · {selected.evidenceIds.length} evidencia(s)</p>
            </div>
            <div className="od-scroll mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
              {selected.sources.map((source) => {
                const isChosen = sourceIsChosen(selected, source)
                return (
                  <button
                    key={source.evidenceId}
                    type="button"
                    disabled={selected.status !== "conflict"}
                    onClick={() => chooseSource(selected.id, source)}
                    className={cn(
                      "w-full rounded-[11px] border px-3.5 py-3 text-left",
                      isChosen ? "border-ink bg-sb" : "border-[#E4E1DC] bg-sb",
                      selected.status !== "conflict" && "cursor-default",
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
                    <p className="ml-[26px] mt-2 whitespace-pre-wrap text-[12.5px] italic leading-[1.55] text-ink">“{source.quote}”</p>
                    {selected.status === "conflict" && source.documentId === selected.suggestedSourceDocumentId && selected.suggestedSourceReason ? (
                      <p className="ml-[26px] mt-1.5 flex items-center gap-1.5 text-[11.5px] text-[#6B5F57]">
                        <Sparkles className="h-[14px] w-[14px] shrink-0 text-[#5B5BD6]" strokeWidth={1.5} /> {selected.suggestedSourceReason}
                      </p>
                    ) : null}
                    {selected.evidenceIds.includes(source.evidenceId) ? <p className="ml-[26px] mt-1.5 font-mono text-[10px] text-ink-5">{source.evidenceId}</p> : null}
                  </button>
                )
              })}
            </div>
            {selected.status === "conflict" ? (
              <div className="mt-3 shrink-0 space-y-1.5">
                <button
                  type="button"
                  disabled={!selected.primarySourceDocumentId || !selected.body.trim()}
                  onClick={confirmSection}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-[9px] bg-ink text-[13px] font-medium text-bg transition-colors hover:bg-[#3F3731] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check className="h-4 w-4" strokeWidth={1.5} /> Confirmar la fuente elegida
                </button>
                <button type="button" onClick={acceptUnresolved} className="flex h-8 w-full items-center justify-center text-[12.5px] text-[#6B5F57] transition-colors hover:bg-[#EDEBE7] hover:text-ink">
                  Dejar ambas y aceptar el conflicto
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3.5 flex shrink-0 items-center gap-2.5 px-1">
        <div className="flex-1 text-[12.5px] leading-[1.3] text-ink-4">
          <p>{sections.length} sección(es) analizada(s){pendingConflicts > 0 ? ` · ${pendingConflicts} conflicto(s) pendiente(s)` : ""}</p>
          {blockedReason ? <p className="mt-1 text-[11px] text-[#96532C]" role="status">{blockedReason}</p> : null}
        </div>
        <button
          type="button"
          disabled={!canCreate}
          title={busy ? "Creando el documento combinado…" : blockedReason ?? "Crear el documento combinado"}
          onClick={() => { if (canCreate) onCreate(destinationName.trim(), sections) }}
          className="flex h-9 items-center gap-2 rounded-[9px] bg-ink px-4 text-[13px] font-medium text-bg transition-colors hover:bg-[#3F3731] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <NotebookPen className="h-4 w-4" strokeWidth={1.5} /> {busy ? "Creando…" : "Crear el documento"}
        </button>
      </div>
    </div>
  )
}
