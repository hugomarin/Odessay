import { describe, expect, it, vi } from "vitest"
import {
  approveArchiveCandidate,
  approveClassificationProposal,
  approveWorkflowDraft,
  createToolResultMessage,
} from "@/lib/agent/workspace-agent-chat"
import type { ArchiveCandidate, ClassificationProposal, WorkflowDraftProposal } from "@/lib/agent/workspace-agent-analysis"
import type { WorkspaceAgentService } from "@/lib/services/workspace-agent-service"

function fakeService(overrides: Partial<WorkspaceAgentService> = {}): WorkspaceAgentService {
  return {
    applyWorkflow: vi.fn(),
    applyClassification: vi.fn(),
    applyArchiveCandidate: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceAgentService
}

describe("createToolResultMessage (ODE-491 — message carries the tool's own structured result)", () => {
  it("carries the given text and toolResult", () => {
    const message = createToolResultMessage("3 archive candidate(s) need review below.", {
      kind: "archive",
      candidates: [],
    })
    expect(message.role).toBe("agent")
    expect(message.text).toBe("3 archive candidate(s) need review below.")
    expect(message.toolResult).toEqual({ kind: "archive", candidates: [] })
  })

  it("gives two runs of the same action two distinct history entries instead of one overwriting the other", () => {
    const first = createToolResultMessage("first run", { kind: "archive", candidates: [] })
    const second = createToolResultMessage("second run", { kind: "archive", candidates: [] })
    expect(first.id).not.toBe(second.id)
  })
})

describe("approval wrappers (ODE-491 — approving a card always calls the correct tool with the correct approval)", () => {
  it("approves a new workflow draft with a write approval scoped to the proposed canonical path", async () => {
    const applyWorkflow = vi.fn().mockResolvedValue({ data: null, error: null })
    const service = fakeService({ applyWorkflow })
    const proposal = { existingDocumentId: null, canonicalPath: "/workspace/workflow.md", markdown: "# Workflow" } as unknown as WorkflowDraftProposal

    await approveWorkflowDraft(service, proposal)

    expect(applyWorkflow).toHaveBeenCalledTimes(1)
    const [calledProposal, approval] = applyWorkflow.mock.calls[0]
    expect(calledProposal).toBe(proposal)
    expect(approval).toMatchObject({ action: "write", resource: "/workspace/workflow.md", approved: true })
  })

  it("approves a workflow revision with a write approval scoped to the existing document id", async () => {
    const applyWorkflow = vi.fn().mockResolvedValue({ data: null, error: null })
    const service = fakeService({ applyWorkflow })
    const proposal = { existingDocumentId: "doc-1", canonicalPath: "/workspace/workflow.md" } as unknown as WorkflowDraftProposal

    await approveWorkflowDraft(service, proposal)

    const [, approval] = applyWorkflow.mock.calls[0]
    expect(approval).toMatchObject({ action: "write", resource: "doc-1" })
  })

  it("approves a classification proposal with an edit approval scoped to its document id", async () => {
    const applyClassification = vi.fn().mockResolvedValue({ data: null, error: null })
    const service = fakeService({ applyClassification })
    const proposal = { documentId: "doc-42" } as unknown as ClassificationProposal

    await approveClassificationProposal(service, proposal)

    expect(applyClassification).toHaveBeenCalledTimes(1)
    const [calledProposal, approval] = applyClassification.mock.calls[0]
    expect(calledProposal).toBe(proposal)
    expect(approval).toMatchObject({ action: "edit", resource: "doc-42", approved: true })
  })

  it("approves an archive candidate with an edit approval scoped to its document id", async () => {
    const applyArchiveCandidate = vi.fn().mockResolvedValue({ data: null, error: null })
    const service = fakeService({ applyArchiveCandidate })
    const candidate = { documentId: "doc-7" } as unknown as ArchiveCandidate

    await approveArchiveCandidate(service, candidate)

    expect(applyArchiveCandidate).toHaveBeenCalledTimes(1)
    const [calledCandidate, approval] = applyArchiveCandidate.mock.calls[0]
    expect(calledCandidate).toBe(candidate)
    expect(approval).toMatchObject({ action: "edit", resource: "doc-7", approved: true })
  })
})
