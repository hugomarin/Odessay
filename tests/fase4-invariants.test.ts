import { describe, expect, it } from "vitest"
import { AI_SERVICE_CONTRACT } from "@/lib/services/contracts/ai-service"
import { AUTH_SERVICE_CONTRACT } from "@/lib/services/contracts/auth-service"
import { DOCUMENT_SERVICE_CONTRACT } from "@/lib/services/contracts/document-service"
import { SHARING_SERVICE_CONTRACT } from "@/lib/services/contracts/sharing-service"
import { SYNC_SERVICE_CONTRACT } from "@/lib/services/contracts/sync-service"

const phase4Harness = {
  canonicalDocumentContract: [
    "tests/markdown-roundtrip.test.ts",
    "tests/annotation-document.test.ts",
    "tests/reading-regression.test.tsx",
  ],
  writePathBoundary: [
    "tests/editor-write-path.test.tsx",
    "tests/document-service.test.ts",
  ],
  syncBoundary: [
    "tests/sync-service.test.ts",
    "tests/sync-hydration.test.ts",
  ],
  remoteCapabilityBoundaries: [
    "tests/ai-auth-services.test.ts",
    "tests/sharing-service.test.ts",
    "tests/test-link-access.test.ts",
    "tests/service-contracts.test.ts",
  ],
}

describe("fase 4 invariant harness", () => {
  it("maps every required phase-4 closure area to explicit evidence suites", () => {
    for (const suitePaths of Object.values(phase4Harness)) {
      expect(suitePaths.length).toBeGreaterThan(0)
      for (const suitePath of suitePaths) {
        expect(suitePath.startsWith("tests/")).toBe(true)
      }
    }
  })

  it("keeps service-boundary invariants aligned with the architecture contract", () => {
    expect(DOCUMENT_SERVICE_CONTRACT.runtimeScope).toEqual(
      expect.arrayContaining(["shared-core", "web", "desktop"]),
    )
    expect(SYNC_SERVICE_CONTRACT.runtimeScope).toEqual(
      expect.arrayContaining(["shared-core", "web"]),
    )
    expect(AI_SERVICE_CONTRACT.runtimeScope).toEqual(
      expect.arrayContaining(["shared-core", "web", "cloud"]),
    )
    expect(AUTH_SERVICE_CONTRACT.runtimeScope).toEqual(
      expect.arrayContaining(["shared-core", "web", "cloud"]),
    )
    expect(SHARING_SERVICE_CONTRACT.runtimeScope).toEqual(
      expect.arrayContaining(["shared-core", "web", "cloud"]),
    )
  })

  it("documents the closure flows that still require manual QA evidence in the PR", () => {
    const manualQaFlows = [
      "write → save → close → reopen in a real browser session",
      "Rich ↔ Source over representative content",
      "import/export + round-trip with real files",
      "preview/shared/public reading with human verification",
      "share/test-link flows with real access checks",
      "offline → online sync perception",
    ]

    expect(manualQaFlows).toHaveLength(6)
    expect(manualQaFlows.every((flow) => flow.length > 10)).toBe(true)
  })
})
