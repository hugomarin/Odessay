import { describe, expect, it } from "vitest"
import type { LocalWriting } from "@/lib/local-db/schema"
import {
  mapRemoteWritingToLocal,
  shouldApplyRemoteWriting,
  type RemoteWritingRecord,
} from "@/lib/sync/remote-bootstrap"

const createLocalWriting = (overrides: Partial<LocalWriting> = {}): LocalWriting => ({
  id: "writing-1",
  author_id: "user-1",
  title: "Local title",
  body_json: { type: "doc", content: [] },
  body_text: "Local text",
  slug: null,
  status: "draft",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version: 1,
  sync_status: "synced",
  deleted_at: null,
  created_at: "2026-03-20T10:00:00.000Z",
  updated_at: "2026-03-20T10:00:00.000Z",
  local_updated_at: 1710928800000,
  ...overrides,
})

const createRemoteWriting = (
  overrides: Partial<RemoteWritingRecord> = {},
): RemoteWritingRecord => ({
  id: "writing-1",
  author_id: "user-1",
  title: "Remote title",
  body_json: { type: "doc", content: [] },
  body_text: "Remote text",
  slug: null,
  status: "draft",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version: 1,
  sync_status: "synced",
  deleted_at: null,
  created_at: "2026-03-20T10:00:00.000Z",
  updated_at: "2026-03-20T10:00:00.000Z",
  ...overrides,
})

describe("remote bootstrap merge policy", () => {
  it("applies remote writing when local does not exist", () => {
    const remote = createRemoteWriting()

    expect(shouldApplyRemoteWriting(null, remote)).toBe(true)
  })

  it("never overrides unsynced local states", () => {
    const remote = createRemoteWriting({ version: 3 })

    expect(shouldApplyRemoteWriting(createLocalWriting({ sync_status: "pending" }), remote)).toBe(
      false,
    )
    expect(shouldApplyRemoteWriting(createLocalWriting({ sync_status: "failed" }), remote)).toBe(
      false,
    )
    expect(shouldApplyRemoteWriting(createLocalWriting({ sync_status: "deleted" }), remote)).toBe(
      false,
    )
  })

  it("applies when remote version is newer than synced local", () => {
    const local = createLocalWriting({ version: 2 })
    const remote = createRemoteWriting({ version: 3 })

    expect(shouldApplyRemoteWriting(local, remote)).toBe(true)
  })

  it("keeps local when it is newer or same version with newer updated_at", () => {
    const local = createLocalWriting({
      version: 3,
      updated_at: "2026-03-21T10:00:00.000Z",
    })
    const remoteOlderVersion = createRemoteWriting({
      version: 2,
      updated_at: "2026-03-22T10:00:00.000Z",
    })
    const remoteOlderTimestamp = createRemoteWriting({
      version: 3,
      updated_at: "2026-03-20T10:00:00.000Z",
    })

    expect(shouldApplyRemoteWriting(local, remoteOlderVersion)).toBe(false)
    expect(shouldApplyRemoteWriting(local, remoteOlderTimestamp)).toBe(false)
  })

  it("maps deleted remote writing to deleted local sync status", () => {
    const local = mapRemoteWritingToLocal(
      createRemoteWriting({
        deleted_at: "2026-03-22T10:00:00.000Z",
      }),
    )

    expect(local.sync_status).toBe("deleted")
  })
})
