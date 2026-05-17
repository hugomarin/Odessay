import { describe, expect, it } from "vitest"
import type { LocalWriting } from "@/lib/local-db/schema"
import {
  mapRemoteWritingToLocal,
  shouldApplyRemoteWriting,
  type RemoteWritingListRecord,
  type RemoteWritingRecord,
} from "@/lib/sync/remote-bootstrap"

const createLocalWriting = (overrides: Partial<LocalWriting> = {}): LocalWriting => ({
  id: "writing-1",
  author_id: "user-1",
  title: "Local title",
  body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
  body_text: "Hello local",
  slug: null,
  status: "draft",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version: 1,
  sync_status: "synced",
  lifecycle: "server-confirmed",
  deleted_at: null,
  created_at: "2026-03-20T10:00:00.000Z",
  updated_at: "2026-03-20T10:00:00.000Z",
  local_updated_at: 1710928800000,
  ...overrides,
})

const createRemoteWriting = (
  overrides: Partial<RemoteWritingListRecord> & Partial<Pick<RemoteWritingRecord, "body_json" | "body_text">> = {},
): RemoteWritingListRecord => ({
  id: "writing-1",
  author_id: "user-1",
  title: "Remote title",
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

describe("remote bootstrap — list shape (no body fields)", () => {
  it("mapRemoteWritingToLocal produces empty body defaults when body is absent and no local exists", () => {
    const remote = createRemoteWriting({ body_json: undefined, body_text: undefined })
    const local = mapRemoteWritingToLocal(remote)

    expect(local.body_json).toEqual({ type: "doc", content: [] })
    expect(local.body_text).toBe("")
  })

  it("mapRemoteWritingToLocal preserves local body when remote lacks body fields", () => {
    const existing = createLocalWriting()
    const remote = createRemoteWriting({
      version: 2,
      body_json: undefined,
      body_text: undefined,
    })
    const local = mapRemoteWritingToLocal(remote, existing)

    expect(local.body_json).toEqual(existing.body_json)
    expect(local.body_text).toBe(existing.body_text)
  })

  it("mapRemoteWritingToLocal uses remote body when present even if local exists", () => {
    const existing = createLocalWriting({ body_text: "Old text" })
    const remote = createRemoteWriting({
      version: 2,
      body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New" }] }] },
      body_text: "New text",
    })
    const local = mapRemoteWritingToLocal(remote, existing)

    expect(local.body_json).toEqual((remote as RemoteWritingRecord).body_json)
    expect(local.body_text).toBe("New text")
  })

  it("shouldApplyRemoteWriting uses version/updated_at and ignores missing body fields", () => {
    const local = createLocalWriting({ version: 1 })
    const remoteNewer = createRemoteWriting({
      version: 2,
      body_json: undefined,
      body_text: undefined,
    })

    expect(shouldApplyRemoteWriting(local, remoteNewer)).toBe(true)
  })

  it("shouldApplyRemoteWriting keeps local when it is newer even if remote lacks body", () => {
    const local = createLocalWriting({ version: 3 })
    const remoteOlder = createRemoteWriting({
      version: 2,
      body_json: undefined,
      body_text: undefined,
    })

    expect(shouldApplyRemoteWriting(local, remoteOlder)).toBe(false)
  })

  it("preserves local body when remote body fields are undefined (list response)", () => {
    const existing = createLocalWriting()
    const remote = createRemoteWriting({
      body_json: undefined,
      body_text: undefined,
    })
    const local = mapRemoteWritingToLocal(remote, existing)

    expect(local.body_json).toEqual(existing.body_json)
    expect(local.body_text).toBe(existing.body_text)
  })

  it("overwrites local body when remote body_json is null (detail with empty body)", () => {
    const existing = createLocalWriting()
    const remote = createRemoteWriting({
      body_json: null,
      body_text: null,
    })
    const local = mapRemoteWritingToLocal(remote, existing)

    // null means the detail endpoint explicitly returned empty body
    expect(local.body_json).toEqual({ type: "doc", content: [] })
    expect(local.body_text).toBe("")
  })
})
