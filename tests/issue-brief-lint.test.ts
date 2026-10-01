import { describe, expect, it } from "vitest"

// ODE-656 — `ops:brief:lint` rules. ODE-593 reached BUILD without an
// Architecture Contract and stopped with a Context Gap mid-run; the lint finds
// that during planning instead.

const { architectureContractSection, lintIssueBrief } = await import("../scripts/lib/issue-brief-lint.mjs")

const COMPLETE = `## Context

Something.

## Architecture Contract

* **Layer:** adapter → service → shell.
* **Runtime scope:** desktop.
* **Owner:** unchanged.
* **Contracts touched:** WATCH-07.
* **Invariants:** no silent overwrite.
* **Required docs:** capability-proof-contract.md.

## Reference docs

- workflow/quality/capability-proof-contract.md

## Validation

Tests.`

describe("ops:brief:lint", () => {
  it("accepts a brief with every Architecture Contract field", () => {
    expect(lintIssueBrief(COMPLETE)).toEqual([])
  })

  it("accepts plain and dash bullet field styles", () => {
    const plain = "## Architecture Contract\n\n- Layer: x\n- Runtime scope: y\n- Owner: z\nContracts touched: a\n* Invariants: b\n* Required docs: c\n* Reference docs: d\n"
    expect(lintIssueBrief(plain)).toEqual([])
  })

  it("accepts a qualifier between the field name and its colon (ODE-619)", () => {
    expect(lintIssueBrief(COMPLETE.replace("* **Invariants:**", "* **Invariants (ADR de identidad D1/D4):**"))).toEqual([])
  })

  it("rejects a brief without the section (ODE-593 before the fix)", () => {
    expect(
      lintIssueBrief("## Context\n\nNo contract here.\n\n## Reference docs\n\n- a.md", [], { requireContract: true }),
    ).toEqual(['Missing "Architecture Contract" section (a heading such as "## Architecture Contract").'])
  })

  it("accepts a non-architectural brief without a contract when it is not required", () => {
    expect(lintIssueBrief("## Context\n\nCopy change.\n\n## Reference docs\n\n- a.md")).toEqual([])
  })

  it("names each missing field", () => {
    const partial = COMPLETE.replace("* **Invariants:** no silent overwrite.\n", "").replace("* **Owner:** unchanged.\n", "")
    expect(lintIssueBrief(partial)).toEqual([
      'Architecture Contract has no "Owner:" field.',
      'Architecture Contract has no "Invariants:" field.',
    ])
  })

  it("does not read fields from outside the section", () => {
    const outside = "## Architecture Contract\n\n* Layer: x\n\n## Notes\n\n* Runtime scope: y\n* Owner: z\n* Contracts touched: a\n* Invariants: b\n* Required docs: c\n* Reference docs: d\n"
    expect(architectureContractSection(outside)).not.toContain("Runtime scope")
    expect(lintIssueBrief(outside)).toHaveLength(5)
  })

  it("rejects a field that is present but empty", () => {
    expect(lintIssueBrief(COMPLETE.replace("* **Owner:** unchanged.", "* **Owner:**"))).toEqual([
      'Architecture Contract field "Owner:" is empty.',
    ])
  })

  it("accepts a field whose value is a nested list", () => {
    const nested = COMPLETE.replace(
      "* **Required docs:** capability-proof-contract.md.",
      "* **Required docs:**\n  * capability-proof-contract.md\n  * odessay-adr-identidad.md",
    )
    expect(lintIssueBrief(nested)).toEqual([])
  })

  it("requires Reference docs as a non-empty section or field", () => {
    const withoutReferences = COMPLETE.replace("## Reference docs\n\n- workflow/quality/capability-proof-contract.md\n\n", "")
    expect(lintIssueBrief(withoutReferences)).toEqual([
      'Missing "Reference docs" (a non-empty "## Reference docs" section or "Reference docs:" field).',
    ])
    const emptySection = COMPLETE.replace("- workflow/quality/capability-proof-contract.md\n", "")
    expect(lintIssueBrief(emptySection)).toHaveLength(1)
  })

  it("requires the Recon Pack comment only when asked", () => {
    expect(lintIssueBrief(COMPLETE, ["Some other comment"])).toEqual([])
    expect(lintIssueBrief(COMPLETE, ["Some other comment"], { requireRecon: true })).toEqual([
      'No "## Recon Pack" comment on the issue.',
    ])
    expect(
      lintIssueBrief(COMPLETE, ["## Recon Pack (verificado en main@5e58443e)\n\n…"], { requireRecon: true }),
    ).toEqual([])
  })
})
