import { afterEach, describe, expect, it } from "vitest"
import {
  clearOdessaySelfWritePathsForTests,
  isOdessaySelfWriteEvent,
  markOdessaySelfWritePath,
  resolveActionableRootIds,
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

describe("resolveActionableRootIds", () => {
  const roots = [
    { id: "root-a", rootPath: "/Users/h/A" },
    { id: "root-b", rootPath: "/Users/h/B" },
  ]

  it("maps a burst to only the roots it touches", () => {
    expect(resolveActionableRootIds(["/Users/h/A/letter.md"], roots)).toEqual(["root-a"])
  })

  it("dedupes multiple paths under the same root to one entry", () => {
    expect(
      resolveActionableRootIds(["/Users/h/A/x.md", "/Users/h/A/y.md"], roots),
    ).toEqual(["root-a"])
  })

  it("returns an empty list for internal .odessay manifest writes (no self-loop)", () => {
    expect(
      resolveActionableRootIds(["/Users/h/A/.odessay/index.json"], roots),
    ).toEqual([])
  })

  it("returns an empty list for legacy internal manifest writes (no self-loop)", () => {
    const legacyDirectory = [".ody", "ssey"].join("")
    expect(
      resolveActionableRootIds([`/Users/h/A/${legacyDirectory}/index.json`], roots),
    ).toEqual([])
  })

  it("returns an empty list for confirmed-delete trash moves", () => {
    expect(
      resolveActionableRootIds(["/Users/h/A/.trash/letter.md"], roots),
    ).toEqual([])
  })

  it("returns every affected root when a burst spans two roots", () => {
    expect(
      resolveActionableRootIds(["/Users/h/A/x.md", "/Users/h/B/y.md"], roots).sort(),
    ).toEqual(["root-a", "root-b"])
  })
})
