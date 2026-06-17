import { afterEach, describe, expect, it } from "vitest"
import {
  clearOdessaySelfWritePathsForTests,
  isOdessaySelfWriteEvent,
  markOdessaySelfWritePath,
  type TauriWatchEvent,
} from "@/lib/services/desktop/tauri-fs-watch"

function modifyEvent(paths: string[]): TauriWatchEvent {
  return {
    type: { modify: { kind: "data" } },
    paths,
    attrs: {},
  }
}

describe("tauri fs watcher self-write suppression", () => {
  afterEach(() => {
    clearOdessaySelfWritePathsForTests()
  })

  it("suppresses watcher events for paths Odessay just wrote", () => {
    const path = "/Users/hugo/Documents/Odessay/letter.md"
    markOdessaySelfWritePath(path, 1_000, 2_000)

    expect(isOdessaySelfWriteEvent(modifyEvent([path]), 1_500)).toBe(true)
  })

  it("does not suppress external edits after the self-write window expires", () => {
    const path = "/Users/hugo/Documents/Odessay/letter.md"
    markOdessaySelfWritePath(path, 1_000, 2_000)

    expect(isOdessaySelfWriteEvent(modifyEvent([path]), 3_001)).toBe(false)
  })

  it("does not suppress mixed events that include an external path", () => {
    const selfWritePath = "/Users/hugo/Documents/Odessay/letter.md"
    const externalPath = "/Users/hugo/Documents/Odessay/notes.md"
    markOdessaySelfWritePath(selfWritePath, 1_000, 2_000)

    expect(isOdessaySelfWriteEvent(modifyEvent([selfWritePath, externalPath]), 1_500)).toBe(false)
  })

  it("ignores internal .odessay paths when classifying self-write events", () => {
    const path = "/Users/hugo/Documents/Odessay/letter.md"
    markOdessaySelfWritePath(path, 1_000, 2_000)

    expect(
      isOdessaySelfWriteEvent(
        modifyEvent([path, "/Users/hugo/Documents/Odessay/.odessay/index.json"]),
        1_500,
      ),
    ).toBe(true)
  })
})
