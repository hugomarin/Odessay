import { describe, expect, it } from "vitest"
import { truncateSessionActionText } from "@/components/agent/workspace-agent-panel"
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
