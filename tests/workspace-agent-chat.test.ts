import { describe, expect, it, vi } from "vitest"
import {
  approveArchiveCandidate,
  approveClassificationProposal,
  approveWorkflowDraft,
  createToolResultMessage,
  resolveExecutionServiceById,
  resolveExecutionServiceByProposal,
  type AgentMessage,
} from "@/lib/agent/workspace-agent-chat"
import type { ArchiveCandidate, ClassificationProposal, ContradictionProposal, WorkflowDraftProposal } from "@/lib/agent/workspace-agent-analysis"
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

  it("carries the given context snapshot (ODE-502 — a message remembers the Writing/Workspace it was produced against)", () => {
    const message = createToolResultMessage(
      "A workflow.md draft is ready to review below.",
      { kind: "archive", candidates: [] },
      undefined,
      { scopeKind: "document", scopeId: "doc-1", scopeLabel: "My Writing", workspaceRootPath: "/root" },
    )
    expect(message.context).toEqual({
      scopeKind: "document",
      scopeId: "doc-1",
      scopeLabel: "My Writing",
      workspaceRootPath: "/root",
    })
  })

  it("leaves context undefined when none is given, so existing call sites remain valid", () => {
    const message = createToolResultMessage("first run", { kind: "archive", candidates: [] })
    expect(message.context).toBeUndefined()
  })

  it("carries the given execution service snapshot (ODE-502 follow-up — a review card remembers which Workspace it was produced against)", () => {
    const serviceA = fakeService()
    const message = createToolResultMessage(
      "A workflow.md draft is ready to review below.",
      { kind: "archive", candidates: [] },
      undefined,
      undefined,
      serviceA,
    )
    expect(message.executionService).toBe(serviceA)
  })
})

describe("resolveExecutionServiceById (ODE-502 follow-up — approving a proposal must not silently use whichever Workspace is now current)", () => {
  it("uses the message's own recorded service, ignoring a different current service", () => {
    const serviceA = fakeService()
    const serviceB = fakeService()
    const messages: AgentMessage[] = [
      createToolResultMessage("Workflow ready", { kind: "workflow", proposal: {} as WorkflowDraftProposal }, "msg-1", undefined, serviceA),
    ]

    const resolved = resolveExecutionServiceById(messages, "msg-1", serviceB)

    expect(resolved).toBe(serviceA)
    expect(resolved).not.toBe(serviceB)
  })

  it("falls back to the current service when the message predates this field", () => {
    const serviceB = fakeService()
    const messages: AgentMessage[] = [
      { id: "msg-1", role: "agent", text: "Workflow ready", toolResult: { kind: "workflow", proposal: {} as WorkflowDraftProposal } },
    ]

    expect(resolveExecutionServiceById(messages, "msg-1", serviceB)).toBe(serviceB)
  })

  it("falls back to the current service when no message matches the id", () => {
    const serviceB = fakeService()
    expect(resolveExecutionServiceById([], "missing", serviceB)).toBe(serviceB)
  })
})

describe("resolveExecutionServiceByProposal (ODE-502 follow-up — contradictions have no messageId, so the owning card is found by proposal id)", () => {
  it("uses the recorded service of the message whose contradictions card still lists this proposal", () => {
    const serviceA = fakeService()
    const serviceB = fakeService()
    const proposal = { id: "contradiction-1" } as unknown as ContradictionProposal
    const messages: AgentMessage[] = [
      createToolResultMessage("Contradictions ready", { kind: "contradictions", proposals: [proposal] }, "msg-1", undefined, serviceA),
    ]

    expect(resolveExecutionServiceByProposal(messages, "contradiction-1", serviceB)).toBe(serviceA)
  })

  it("falls back to the current service when no card lists this proposal (e.g. already resolved)", () => {
    const serviceB = fakeService()
    expect(resolveExecutionServiceByProposal([], "contradiction-1", serviceB)).toBe(serviceB)
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
