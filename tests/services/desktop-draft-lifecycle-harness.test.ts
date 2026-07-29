/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getDesktopDraftLifecycleHarness,
  installDesktopDraftLifecycleHarness,
} from "@/lib/testing/desktop-draft-lifecycle-harness"

describe("ODE-406 — desktop draft lifecycle boundary", () => {
  beforeEach(() => {
    vi.resetModules()
    installDesktopDraftLifecycleHarness()
  })

  it("has zero durable effects before DocumentService materialization", () => {
    expect(getDesktopDraftLifecycleHarness()).toMatchObject({
      installed: true, materializations: 0, filesystemWrites: 0, manifestWrites: 0,
      catalogWrites: 0, syncEnqueues: 0, cloudWrites: 0,
    })
  })

  it("records exactly one local transition and never writes cloud synchronously", async () => {
    const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
    const result = await createDesktopDraft({
      writingId: "11111111-1111-4111-8111-111111111111",
      title: "Untitled",
      initialBodyText: "First words",
      initialBodyJson: { type: "doc", content: [{ type: "paragraph" }] },
    })

    expect(result.error).toBeNull()
    expect(result.data?.id).toBe("11111111-1111-4111-8111-111111111111")
    expect(getDesktopDraftLifecycleHarness()).toMatchObject({
      materializations: 1, filesystemWrites: 1, manifestWrites: 1,
      catalogWrites: 1, syncEnqueues: 1, cloudWrites: 0,
    })
  })
})
