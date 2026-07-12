import { describe, expect, it } from "vitest"
import {
  deriveDocumentStateForLocalWriting,
  deriveDocumentStateFromCatalogRecord,
  deriveDocumentStateFromSignals,
} from "@/lib/writings/document-state"
import type { LocalWriting } from "@/lib/local-db/schema"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"

const makeWriting = (partial: Partial<LocalWriting> = {}): LocalWriting => ({
  id: partial.id ?? "writing-1",
  title: partial.title ?? "Writing",
  canonical_path: partial.canonical_path,
  body_json: partial.body_json ?? { type: "doc" },
  body_text: partial.body_text ?? "",
  status: partial.status ?? "draft",
  visibility: partial.visibility ?? "private",
  version: partial.version ?? 1,
  sync_status: partial.sync_status ?? "synced",
  lifecycle: partial.lifecycle ?? "server-confirmed",
  created_at: partial.created_at ?? "2026-06-18T00:00:00.000Z",
  updated_at: partial.updated_at ?? "2026-06-18T00:00:00.000Z",
  local_updated_at: partial.local_updated_at ?? 1,
})

describe("document state derivation", () => {
  it("derives cloud-only from a cloud record without a local file", () => {
    expect(
      deriveDocumentStateForLocalWriting(
        makeWriting({
          lifecycle: "server-confirmed",
          sync_status: "synced",
          canonical_path: null,
        }),
      ),
    ).toBe("cloud-only")
  })

  it("derives local-only from a local file without a cloud record", () => {
    expect(
      deriveDocumentStateForLocalWriting(
        makeWriting({
          lifecycle: "local-only",
          sync_status: "synced",
          canonical_path: "/docs/local.md",
        }),
      ),
    ).toBe("local-only")
  })

  it("derives synced only when both cloud and local file signals are present", () => {
    expect(
      deriveDocumentStateForLocalWriting(
        makeWriting({
          lifecycle: "server-confirmed",
          sync_status: "synced",
          canonical_path: "/docs/synced.md",
        }),
      ),
    ).toBe("synced")
  })

  it("gives pending state priority over cloud/local signals", () => {
    expect(
      deriveDocumentStateForLocalWriting(
        makeWriting({
          lifecycle: "server-confirmed",
          sync_status: "pending",
          canonical_path: "/docs/pending.md",
        }),
      ),
    ).toBe("pending")

    expect(
      deriveDocumentStateForLocalWriting(
        makeWriting({
          lifecycle: "syncing",
          sync_status: "synced",
          canonical_path: "/docs/syncing.md",
        }),
      ),
    ).toBe("pending")
  })

  it("keeps a failed sync distinct from an in-flight sync", () => {
    expect(
      deriveDocumentStateForLocalWriting(
        makeWriting({ lifecycle: "server-confirmed", sync_status: "failed", canonical_path: "/docs/failed.md" }),
      ),
    ).toBe("sync-failed")
  })

  it("treats a standalone local file as local-only", () => {
    expect(
      deriveDocumentStateFromSignals({
        hasCloudRecord: false,
        hasLocalFile: true,
        isPending: false,
      }),
    ).toBe("local-only")
  })
})

const makeRecord = (
  partial: Partial<DocumentCatalogRecord> = {},
): Pick<DocumentCatalogRecord, "localPresent" | "cloudPresent" | "syncStatus"> => ({
  localPresent: partial.localPresent ?? true,
  cloudPresent: partial.cloudPresent ?? false,
  syncStatus: partial.syncStatus ?? "local-only",
})

describe("catalog record state derivation (shared by Desk and Workspace)", () => {
  it("derives identity states from presence signals", () => {
    expect(deriveDocumentStateFromCatalogRecord(makeRecord({ localPresent: true, cloudPresent: false }))).toBe(
      "local-only",
    )
    expect(
      deriveDocumentStateFromCatalogRecord(
        makeRecord({ localPresent: true, cloudPresent: true, syncStatus: "synced" }),
      ),
    ).toBe("synced")
    expect(
      deriveDocumentStateFromCatalogRecord(makeRecord({ localPresent: false, cloudPresent: true })),
    ).toBe("cloud-only")
  })

  it("surfaces sync queue states", () => {
    expect(deriveDocumentStateFromCatalogRecord(makeRecord({ syncStatus: "pending" }))).toBe("pending")
    expect(deriveDocumentStateFromCatalogRecord(makeRecord({ syncStatus: "failed" }))).toBe("sync-failed")
    expect(deriveDocumentStateFromCatalogRecord(makeRecord({ syncStatus: "conflict" }))).toBe("conflict")
  })

  it("prioritizes operational recovery states over identity/sync", () => {
    const synced = makeRecord({ localPresent: true, cloudPresent: true, syncStatus: "synced" })
    expect(deriveDocumentStateFromCatalogRecord(synced, { rebuilding: true })).toBe("rebuilding")
    expect(deriveDocumentStateFromCatalogRecord(synced, { ambiguous: true })).toBe("ambiguous")
    expect(deriveDocumentStateFromCatalogRecord(synced, { stale: true })).toBe("stale")
    // A hard conflict outranks a list-wide stale overlay.
    expect(
      deriveDocumentStateFromCatalogRecord(makeRecord({ syncStatus: "conflict" }), { stale: true }),
    ).toBe("conflict")
  })
})
