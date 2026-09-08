import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Resource: class {},
  Channel: class {},
}))

import { tauriWriteFile, tauriWriteBinaryFile } from "@/lib/services/desktop/tauri-commands"
import {
  clearOdessaySelfWritePathsForTests,
  isOdessaySelfWriteEvent,
} from "@/lib/services/desktop/tauri-fs-watch"

function modifyEvent(paths: string[]) {
  return { type: { modify: { kind: "any" } }, paths, attrs: {} }
}

describe("tauriWriteFile / tauriWriteBinaryFile self-write coverage", () => {
  afterEach(() => {
    clearOdessaySelfWritePathsForTests()
  })

  it("suppresses the .tmp sibling's create/rename, not just the final path's rename", async () => {
    // write_file (Rust) writes `${path}.tmp` then renames it onto `path` — the
    // watcher reports separate events for the .tmp create/rename before the
    // final rename onto `path`. Marking only `path` left those two events
    // looking external, waking a full BindingRoot reconcile on every save.
    const path = "/Users/hugo/Documents/Odessay/letter.md"

    await tauriWriteFile(path, "hola")

    expect(isOdessaySelfWriteEvent(modifyEvent([`${path}.tmp`]))).toBe(true)
    expect(isOdessaySelfWriteEvent(modifyEvent([path]))).toBe(true)
  })

  it("does the same for binary writes", async () => {
    const path = "/Users/hugo/Documents/Odessay/export.pdf"

    await tauriWriteBinaryFile(path, new Uint8Array([1, 2, 3]))

    expect(isOdessaySelfWriteEvent(modifyEvent([`${path}.tmp`]))).toBe(true)
    expect(isOdessaySelfWriteEvent(modifyEvent([path]))).toBe(true)
  })
})
