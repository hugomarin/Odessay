import { describe, expect, it } from "vitest"
import {
  MAX_WORKFLOW_INSTRUCTIONS_CHARS,
  MAX_WORKFLOW_SCOPE_HEADINGS,
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
    expect(split.scopeSummary).toEqual(["Workflow: publication"])
  })

  it("treats a file without the marker as entirely instructions (generated drafts are intent/scope content)", () => {
    const markdown = "# Workspace workflow\n\n## Intent\nKeep everything discoverable."

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toBe(markdown)
    expect(split.definitions).toBeNull()
    expect(split.instructionsTruncated).toBe(false)
    expect(split.scopeSummary).toEqual([])
  })

  it("never trusts an unbounded no-marker file: the overflow beyond the cap becomes on-demand definitions", () => {
    const long = "x".repeat(MAX_WORKFLOW_INSTRUCTIONS_CHARS + 500)
    const markdown = `${long}\n\n## Workflow: publication\nSteps: review, export, archive.`

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toHaveLength(MAX_WORKFLOW_INSTRUCTIONS_CHARS)
    expect(split.instructionsTruncated).toBe(true)
    expect(split.definitions).toContain("## Workflow: publication")
    expect(split.scopeSummary).toEqual(["Workflow: publication"])
  })

  it("caps the instructions at the marker too when the author writes oversized instructions", () => {
    const long = "x".repeat(MAX_WORKFLOW_INSTRUCTIONS_CHARS + 100)
    const markdown = `${long}\n\n${WORKFLOW_DEFINITIONS_MARKER}\n\n## Workflow: tiny\nDo the thing.`

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toHaveLength(MAX_WORKFLOW_INSTRUCTIONS_CHARS)
    expect(split.instructionsTruncated).toBe(true)
    expect(split.definitions).toBe("\n\n## Workflow: tiny\nDo the thing.")
    expect(split.scopeSummary).toEqual(["Workflow: tiny"])
  })

  it("does not truncate instructions exactly at the cap", () => {
    const exact = "x".repeat(MAX_WORKFLOW_INSTRUCTIONS_CHARS)

    const split = splitWorkflowMarkdown(exact)

    expect(split.instructions).toBe(exact)
    expect(split.instructionsTruncated).toBe(false)
  })

  it("caps the scope summary at a bounded number of headings", () => {
    const definitions = Array.from(
      { length: MAX_WORKFLOW_SCOPE_HEADINGS + 4 },
      (_, index) => `\n## Workflow: number-${index}\nSteps.`,
    ).join("")
    const markdown = `# Workflow\n\n${WORKFLOW_DEFINITIONS_MARKER}${definitions}`

    const split = splitWorkflowMarkdown(markdown)

    expect(split.scopeSummary).toHaveLength(MAX_WORKFLOW_SCOPE_HEADINGS)
    expect(split.scopeSummary[0]).toBe("Workflow: number-0")
  })

  it("keeps instructions side empty-string-safe so an empty ambient section is reported as null by the service, not here", () => {
    const markdown = `${WORKFLOW_DEFINITIONS_MARKER}\n\n## Workflow: only\nDo the thing.`

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toBe("")
    expect(split.definitions).toBe("\n\n## Workflow: only\nDo the thing.")
  })
})
