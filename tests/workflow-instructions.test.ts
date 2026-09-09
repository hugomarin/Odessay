import { describe, expect, it } from "vitest"
import {
  MAX_WORKFLOW_INSTRUCTIONS_CHARS,
  WORKFLOW_DEFINITIONS_MARKER,
  splitWorkflowMarkdown,
} from "@/lib/agent/workflow-instructions"

describe("splitWorkflowMarkdown (ODE-504 — hybrid workflow.md instructions model)", () => {
  it("splits at the marker: everything before is instructions, everything after is definitions", () => {
    const markdown = [
      "# Workspace workflow",
      "",
      "## Intent",
      "Keep everything discoverable.",
      "",
      WORKFLOW_DEFINITIONS_MARKER,
      "",
      "## Workflow: publication",
      "Steps: review, export, archive.",
    ].join("\n")

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toBe("# Workspace workflow\n\n## Intent\nKeep everything discoverable.")
    expect(split.definitions).toBe("\n\n## Workflow: publication\nSteps: review, export, archive.")
    expect(split.instructionsTruncated).toBe(false)
  })

  it("treats a file without the marker as entirely instructions (generated drafts are intent/scope content)", () => {
    const markdown = "# Workspace workflow\n\n## Intent\nKeep everything discoverable."

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toBe(markdown)
    expect(split.definitions).toBeNull()
    expect(split.instructionsTruncated).toBe(false)
  })

  it("caps the ambient instructions and flags the truncation so the descriptor can disclose it", () => {
    const long = "x".repeat(MAX_WORKFLOW_INSTRUCTIONS_CHARS + 500)
    const markdown = `${long}\n\n${WORKFLOW_DEFINITIONS_MARKER}\n\n## Workflow: tiny\nDo the thing.`

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toHaveLength(MAX_WORKFLOW_INSTRUCTIONS_CHARS)
    expect(split.instructionsTruncated).toBe(true)
    expect(split.definitions).toBe("\n\n## Workflow: tiny\nDo the thing.")
  })

  it("does not truncate instructions exactly at the cap", () => {
    const exact = "x".repeat(MAX_WORKFLOW_INSTRUCTIONS_CHARS)

    const split = splitWorkflowMarkdown(exact)

    expect(split.instructions).toBe(exact)
    expect(split.instructionsTruncated).toBe(false)
  })

  it("keeps instructions side empty-string-safe so an empty ambient section is reported as null by the service, not here", () => {
    const markdown = `${WORKFLOW_DEFINITIONS_MARKER}\n\n## Workflow: only\nDo the thing.`

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toBe("")
    expect(split.definitions).toBe("\n\n## Workflow: only\nDo the thing.")
  })
})
