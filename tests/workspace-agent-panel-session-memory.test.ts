import { describe, expect, it } from "vitest"
import {
  buildWorkspaceAgentContextAttachments,
  isExplicitWorkspaceAgentActionRequest,
  truncateSessionActionText,
} from "@/components/agent/workspace-agent-panel"
import { MAX_WORKSPACE_ASK_SESSION_ACTION_CHARS } from "@/lib/ai/workspace-ask"

describe("truncateSessionActionText", () => {
  it("leaves text at or under the limit untouched", () => {
    const text = "a".repeat(MAX_WORKSPACE_ASK_SESSION_ACTION_CHARS)
    expect(truncateSessionActionText(text)).toBe(text)
    expect(truncateSessionActionText(text).length).toBeLessThanOrEqual(MAX_WORKSPACE_ASK_SESSION_ACTION_CHARS)
  })

  it("truncates text over the limit so the result — including the ellipsis — never exceeds it", () => {
    // Regression: an earlier version sliced to the full limit and then
    // appended "…", landing one character over — which made the schema
    // reject every subsequent askWorkspace request for the rest of the
    // session (INVALID_INPUT, "Could not read the Workspace agent request.").
    const text = "a".repeat(MAX_WORKSPACE_ASK_SESSION_ACTION_CHARS + 50)
    const result = truncateSessionActionText(text)
    expect(result.length).toBeLessThanOrEqual(MAX_WORKSPACE_ASK_SESSION_ACTION_CHARS)
    expect(result.endsWith("…")).toBe(true)
  })

  it("truncates text exactly one character over the limit", () => {
    const text = "a".repeat(MAX_WORKSPACE_ASK_SESSION_ACTION_CHARS + 1)
    const result = truncateSessionActionText(text)
    expect(result.length).toBe(MAX_WORKSPACE_ASK_SESSION_ACTION_CHARS)
  })
})

describe("buildWorkspaceAgentContextAttachments", () => {
  it("adds Workspace list selections without duplicating composer attachments", () => {
    const attachments = [{ kind: "file" as const, id: "doc-a", path: "a.md", label: "A" }]

    expect(buildWorkspaceAgentContextAttachments(attachments, ["doc-a", "doc-b", " "])).toEqual([
      ...attachments,
      {
        kind: "file",
        id: "doc-b",
        path: "",
        label: "Selected Workspace artifact",
      },
    ])
  })
})

describe("isExplicitWorkspaceAgentActionRequest", () => {
  it("does not dispatch an action suggested for a factual question", () => {
    expect(isExplicitWorkspaceAgentActionRequest(
      "¿Cuál es el cupo máximo del taller y cuál es su objetivo principal?",
      "workflow",
    )).toBe(false)
  })

  it("dispatches an explicitly requested action", () => {
    expect(isExplicitWorkspaceAgentActionRequest("Revisa las contradicciones entre estos documentos.", "contradictions")).toBe(true)
    expect(isExplicitWorkspaceAgentActionRequest("¿Puedes generar el workflow?", "workflow")).toBe(true)
  })
})
