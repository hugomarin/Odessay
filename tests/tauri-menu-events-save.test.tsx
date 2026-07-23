/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-401/ODE-402 — "Save to disk / Save As" delegates the physical
 * move to the consumer (no untracked copy is ever written by the hook), adopts
 * the confirmed — possibly collision-suffixed — path as the save target, and
 * keeps the previous target when the move did not materialize.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useTauriMenuEvents } from "@/hooks/useTauriMenuEvents"

;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  saveDialog: vi.fn(),
  openDialog: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}))
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mocks.saveDialog,
  open: mocks.openDialog,
}))

// The menu event bus registers one Tauri listener per action per process, so
// the dispatch closures are captured once and reused across tests.
const registeredHandlers = new Map<string, () => unknown>()

let container: HTMLDivElement
let root: Root | null = null
let onSaveToDisk: ((path: string, content: string) => Promise<string | false>) | undefined

function Harness() {
  useTauriMenuEvents({
    onOpenFile: () => {},
    onNewFile: () => {},
    onGetSaveContent: () => ({ content: "# Letter\n", defaultName: "Letter" }),
    onSaveToDisk: onSaveToDisk
      ? (path, content) => onSaveToDisk!(path, content)
      : undefined,
    documentKey: "writing-1",
  })
  return null
}

async function emit(action: string) {
  await act(async () => {
    registeredHandlers.get(action)?.()
  })
}

async function mountHarness() {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness />))
  await vi.waitFor(() => {
    expect(registeredHandlers.has("save-as")).toBe(true)
    expect(registeredHandlers.has("save-to-disk")).toBe(true)
  })
}

beforeEach(async () => {
  mocks.saveDialog.mockReset()
  mocks.openDialog.mockReset()
  mocks.invoke.mockReset()
  onSaveToDisk = undefined
  mocks.listen.mockImplementation(async (channel: string, handler: () => unknown) => {
    registeredHandlers.set(channel.replace("menu:", ""), handler)
    return () => {}
  })
  mocks.invoke.mockResolvedValue(undefined)
  mocks.saveDialog.mockResolvedValue("/chosen/Letter.md")
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container.remove()
})

describe("useTauriMenuEvents save flow", () => {
  it("never writes an untracked copy and reopens the picker when the move fails", async () => {
    const saveToDisk = vi.fn(async () => false as const)
    onSaveToDisk = saveToDisk
    await mountHarness()

    await emit("save-as")
    await vi.waitFor(() =>
      expect(saveToDisk).toHaveBeenCalledWith("/chosen/Letter.md", "# Letter\n"),
    )

    // The hook must not write anything itself: no double copy at the chosen path.
    expect(mocks.invoke).not.toHaveBeenCalledWith("write_file", expect.anything())

    // A later plain save must open the picker again instead of silently
    // adopting a path the document never moved to.
    mocks.saveDialog.mockResolvedValue("/chosen-2/Letter.md")
    await emit("save-to-disk")
    await vi.waitFor(() =>
      expect(saveToDisk).toHaveBeenCalledWith("/chosen-2/Letter.md", "# Letter\n"),
    )
    expect(mocks.saveDialog).toHaveBeenCalledTimes(2)
  })

  it("adopts the confirmed (collision-suffixed) path as the next save target", async () => {
    const saveToDisk = vi.fn(async () => "/chosen/Letter 2.md")
    onSaveToDisk = saveToDisk
    await mountHarness()

    await emit("save-as")
    await vi.waitFor(() => expect(saveToDisk).toHaveBeenCalledTimes(1))

    await emit("save-to-disk")
    await vi.waitFor(() => expect(saveToDisk).toHaveBeenCalledTimes(2))
    expect(mocks.saveDialog).toHaveBeenCalledTimes(1)
    expect(saveToDisk).toHaveBeenLastCalledWith("/chosen/Letter 2.md", "# Letter\n")
    expect(mocks.invoke).not.toHaveBeenCalledWith("write_file", expect.anything())
  })

  it("falls back to a plain write when no move handler is provided", async () => {
    await mountHarness()

    await emit("save-as")
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("write_file", {
        path: "/chosen/Letter.md",
        content: "# Letter\n",
      }),
    )

    await emit("save-to-disk")
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2))
    expect(mocks.saveDialog).toHaveBeenCalledTimes(1)
  })
})
