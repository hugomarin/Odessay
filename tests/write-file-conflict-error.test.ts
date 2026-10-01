import { describe, expect, it } from "vitest"

import { WriteFileConflictError } from "@/lib/services/desktop/write-file-conflict-error"

describe("WriteFileConflictError (WATCH-07)", () => {
  it("parses the last kept-path marker and preserves punctuation in the path", () => {
    const message =
      "CONFLICT: /tmp/Letter; draft.md changed on disk while the save was being written; another version was kept at /tmp/Letter; draft.md.conflict-1a2b3c4d"
    const error = new WriteFileConflictError(message)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("WriteFileConflictError")
    expect(error.message).toBe(message)
    expect(error.keptPath).toBe("/tmp/Letter; draft.md.conflict-1a2b3c4d")
    expect(error.preservationFailed).toBe(false)
  })

  it("marks Rust's keep_beside failure without treating the temporary path as keptPath", () => {
    const message =
      "CONFLICT: /tmp/Letter.md changed on disk while the save was being written, and the version found there could not be kept (Permission denied); it remains at /tmp/Letter.md.tmp"
    const error = new WriteFileConflictError(message)

    expect(error.message).toBe(message)
    expect(error.keptPath).toBeNull()
    expect(error.preservationFailed).toBe(true)
  })

  it("leaves ordinary stale-hash conflicts without a kept version", () => {
    const error = new WriteFileConflictError(
      "CONFLICT: /tmp/Letter.md changed on disk since it was last read (expected blake3:old, found blake3:new)",
    )

    expect(error.keptPath).toBeNull()
    expect(error.preservationFailed).toBe(false)
  })
})
