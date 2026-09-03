import { beforeEach, describe, expect, it, vi } from "vitest"
import type { VocabularyItem } from "@/lib/vocabulary/types"

const {
  appConfigDirMock,
  listVocabularyMock,
  applyVocabularyMergeLocallyMock,
  listCloudVocabularyMock,
  upsertVocabularyItemRowsMock,
} = vi.hoisted(() => ({
  appConfigDirMock: vi.fn(async () => "/tmp/odessay-config"),
  listVocabularyMock: vi.fn(),
  applyVocabularyMergeLocallyMock: vi.fn(async () => {}),
  listCloudVocabularyMock: vi.fn(),
  upsertVocabularyItemRowsMock: vi.fn(async () => null),
}))

vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: appConfigDirMock,
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: vi.fn(() => ({})),
}))

vi.mock("@/lib/services/desktop/desktop-settings-service", () => ({
  DesktopSettingsService: class {
    listVocabulary = listVocabularyMock
    applyVocabularyMergeLocally = applyVocabularyMergeLocallyMock
  },
}))

vi.mock("@/lib/vocabulary/server", () => ({
  listVocabulary: listCloudVocabularyMock,
  upsertVocabularyItemRows: upsertVocabularyItemRowsMock,
}))

function item(kind: "type" | "status", key: string, updatedAt: string, overrides: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: `${kind}:${key}`,
    kind,
    key,
    name: key,
    description: "",
    icon: "compass",
    color: "#5B5BD6",
    hidden: false,
    isBase: false,
    isRequired: false,
    position: 0,
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  }
}

describe("reconcileVocabularyOnSignIn", () => {
  beforeEach(() => {
    listVocabularyMock.mockReset()
    applyVocabularyMergeLocallyMock.mockReset().mockResolvedValue(undefined)
    listCloudVocabularyMock.mockReset()
    upsertVocabularyItemRowsMock.mockReset().mockResolvedValue(null)
  })

  it("reports synced with no writes when local and cloud already match", async () => {
    const shared = item("type", "general", "2026-01-01T00:00:00.000Z")
    listVocabularyMock.mockResolvedValue({ data: [shared], error: null })
    listCloudVocabularyMock.mockResolvedValue({ data: [shared], error: null })

    const { reconcileVocabularyOnSignIn } = await import("@/lib/services/desktop/vocabulary-reconciler")
    const outcome = await reconcileVocabularyOnSignIn("user-1")

    expect(outcome).toEqual({ status: "synced" })
    expect(applyVocabularyMergeLocallyMock).not.toHaveBeenCalled()
    expect(upsertVocabularyItemRowsMock).not.toHaveBeenCalled()
  })

  it("applies a cloud-only item locally", async () => {
    const cloudOnly = item("status", "blocked", "2026-01-01T00:00:00.000Z")
    listVocabularyMock.mockResolvedValue({ data: [], error: null })
    listCloudVocabularyMock.mockResolvedValue({ data: [cloudOnly], error: null })

    const { reconcileVocabularyOnSignIn } = await import("@/lib/services/desktop/vocabulary-reconciler")
    const outcome = await reconcileVocabularyOnSignIn("user-1")

    expect(outcome).toEqual({ status: "synced" })
    expect(applyVocabularyMergeLocallyMock).toHaveBeenCalledWith([cloudOnly])
    expect(upsertVocabularyItemRowsMock).not.toHaveBeenCalled()
  })

  it("uploads a local-only item to the cloud", async () => {
    const localOnly = item("type", "research", "2026-01-01T00:00:00.000Z")
    listVocabularyMock.mockResolvedValue({ data: [localOnly], error: null })
    listCloudVocabularyMock.mockResolvedValue({ data: [], error: null })

    const { reconcileVocabularyOnSignIn } = await import("@/lib/services/desktop/vocabulary-reconciler")
    const outcome = await reconcileVocabularyOnSignIn("user-1")

    expect(outcome).toEqual({ status: "synced" })
    expect(upsertVocabularyItemRowsMock).toHaveBeenCalledWith(expect.anything(), "user-1", [localOnly])
  })

  it("reports pending when the cloud read fails, and touches nothing local", async () => {
    listCloudVocabularyMock.mockResolvedValue({
      data: null,
      error: { code: "DB_ERROR", message: "connection reset", retryable: true },
    })

    const { reconcileVocabularyOnSignIn } = await import("@/lib/services/desktop/vocabulary-reconciler")
    const outcome = await reconcileVocabularyOnSignIn("user-1")

    expect(outcome.status).toBe("pending")
    expect(listVocabularyMock).not.toHaveBeenCalled()
    expect(applyVocabularyMergeLocallyMock).not.toHaveBeenCalled()
  })

  it("retries once when local changed between the snapshot and the write, then succeeds against the fresh state", async () => {
    const cloudOnly = item("status", "blocked", "2026-01-01T00:00:00.000Z")
    listCloudVocabularyMock.mockResolvedValue({ data: [cloudOnly], error: null })

    // First read (snapshot): empty. Second read (pre-write check): a concurrent
    // edit landed — a new local item appeared. Third read (retry snapshot):
    // reflects that same edit, so the retry's own pre-write check matches.
    const concurrentEdit = item("type", "concurrent", "2026-01-02T00:00:00.000Z")
    listVocabularyMock
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [concurrentEdit], error: null })
      .mockResolvedValueOnce({ data: [concurrentEdit], error: null })
      .mockResolvedValueOnce({ data: [concurrentEdit], error: null })

    const { reconcileVocabularyOnSignIn } = await import("@/lib/services/desktop/vocabulary-reconciler")
    const outcome = await reconcileVocabularyOnSignIn("user-1")

    expect(outcome).toEqual({ status: "synced" })
    // Applied against the merge computed from the fresh (post-edit) snapshot.
    expect(applyVocabularyMergeLocallyMock).toHaveBeenCalledTimes(1)
    expect(applyVocabularyMergeLocallyMock).toHaveBeenCalledWith([cloudOnly])
  })

  it("aborts as pending, leaving local untouched, if the collision repeats on retry", async () => {
    const cloudOnly = item("status", "blocked", "2026-01-01T00:00:00.000Z")
    listCloudVocabularyMock.mockResolvedValue({ data: [cloudOnly], error: null })

    // Every read returns something different from the last, so the pre-write
    // fingerprint check never matches its own snapshot.
    let call = 0
    listVocabularyMock.mockImplementation(async () => {
      call += 1
      return {
        data: [item("type", `churn-${call}`, `2026-01-0${call}T00:00:00.000Z`)],
        error: null,
      }
    })

    const { reconcileVocabularyOnSignIn } = await import("@/lib/services/desktop/vocabulary-reconciler")
    const outcome = await reconcileVocabularyOnSignIn("user-1")

    expect(outcome.status).toBe("pending")
    expect(applyVocabularyMergeLocallyMock).not.toHaveBeenCalled()
  })
})
