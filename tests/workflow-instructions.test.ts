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

  it("treats a file without the marker as entirely instructions when every block is a known intent/scope section (generated drafts)", () => {
    const markdown = "# Workspace workflow\n\n## Intent\nKeep everything discoverable."

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toBe(markdown)
    expect(split.definitions).toBeNull()
    expect(split.instructionsTruncated).toBe(false)
    expect(split.scopeSummary).toEqual([])
  })

  it("separates a legacy short file's executable definitions even without the marker (review round 2 — P1)", () => {
    const markdown = "# Workflow\n\n## Workflow: publication\nSteps: review, export, archive."

    const split = splitWorkflowMarkdown(markdown)

    // Only the title is trusted; the executable definition becomes on-demand
    // evidence with its scope surfaced in the descriptor.
    expect(split.instructions).toBe("# Workflow")
    expect(split.definitions).toBe("## Workflow: publication\nSteps: review, export, archive.")
    expect(split.instructionsTruncated).toBe(false)
    expect(split.scopeSummary).toEqual(["Workflow: publication"])
  })

  it("trusts only the first H1 heading line, never its unclassified executable body", () => {
    const markdown = "# Publish release\n\n1. Review\n2. Export\n3. Archive"

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toBe("# Publish release")
    expect(split.definitions).toBe("1. Review\n2. Export\n3. Archive")
    expect(split.instructionsTruncated).toBe(false)
    expect(split.scopeSummary).toEqual(["Definitions without heading: Review"])
  })

  it("keeps a fully unheaded legacy workflow on demand instead of promoting it wholesale to instructions", () => {
    const markdown = "Run this process:\n1. Review\n2. Export\n3. Archive"

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toBe("")
    expect(split.definitions).toBe(markdown)
    expect(split.instructionsTruncated).toBe(false)
    expect(split.scopeSummary).toEqual(["Definitions without heading: Run this process:"])
  })

  it("keeps prose before any heading as trusted instructions even in a mixed legacy file", () => {
    const markdown = [
      "Coordinate this workspace: keep artifacts classified and named consistently.",
      "",
      "## Workflow: publication",
      "Steps: review, export, archive.",
    ].join("\n")

    const split = splitWorkflowMarkdown(markdown)

    expect(split.instructions).toBe("Coordinate this workspace: keep artifacts classified and named consistently.")
    expect(split.definitions).toBe("## Workflow: publication\nSteps: review, export, archive.")
    expect(split.scopeSummary).toEqual(["Workflow: publication"])
  })

  it("recognizes headings at any level (H1–H6) for the scope summary", () => {
    const markdown = [
      "# Workflow",
      "",
      WORKFLOW_DEFINITIONS_MARKER,
      "",
      "# Workflow: top-level",
      "Steps.",
      "#### Sub-workflow: revision",
      "Details.",
    ].join("\n")

    const split = splitWorkflowMarkdown(markdown)

    expect(split.scopeSummary).toEqual(["Workflow: top-level", "Sub-workflow: revision"])
  })

  it("always reports bounded scope when marked definitions have no heading", () => {
    const markdown = [
      "# Manual",
      "",
      WORKFLOW_DEFINITIONS_MARKER,
      "",
      "1. Review",
      "2. Export",
      "3. Archive",
    ].join("\n")

    const split = splitWorkflowMarkdown(markdown)

    expect(split.definitions).toBe("\n\n1. Review\n2. Export\n3. Archive")
    expect(split.scopeSummary).toEqual(["Definitions without heading: Review"])
  })

  it("reports both an unheaded definition prefix and later headed definitions", () => {
    const markdown = [
      "# Manual",
      "",
      WORKFLOW_DEFINITIONS_MARKER,
      "",
      "1. Review the draft",
      "",
      "## Recovery",
      "Restore the previous version.",
    ].join("\n")

    const split = splitWorkflowMarkdown(markdown)

    expect(split.scopeSummary).toEqual([
      "Definitions without heading: Review the draft",
      "Recovery",
    ])
  })

  it("never trusts an unbounded no-marker file: unrecognized blocks become on-demand definitions", () => {
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
    const heading = "## Intent\n"
    const exact = `${heading}${"x".repeat(MAX_WORKFLOW_INSTRUCTIONS_CHARS - heading.length)}`

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
