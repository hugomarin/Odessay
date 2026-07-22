/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-401 — a "Save to disk / Save As" whose relocate did not
 * materialize must not adopt the chosen path as the save target.
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
let onSaveComplete: (path: string) => Promise<boolean | void>

function Harness() {
  useTauriMenuEvents({
    onOpenFile: () => {},
    onNewFile: () => {},
    onGetSaveContent: () => ({ content: "# Letter\n", defaultName: "Letter" }),
    onSaveComplete: (path) => onSaveComplete(path),
    documentKey: "writing-1",
  })
  return null
}

async function emit(action: string) {
  await act(async () => {
    registeredHandlers.get(action)?.()
  })
}

beforeEach(async () => {
  mocks.saveDialog.mockReset()
  mocks.openDialog.mockReset()
  mocks.invoke.mockReset()
  onSaveComplete = async () => true
  mocks.listen.mockImplementation(async (channel: string, handler: () => unknown) => {
    registeredHandlers.set(channel.replace("menu:", ""), handler)
    return () => {}
  })
  mocks.invoke.mockResolvedValue(undefined)
  mocks.saveDialog.mockResolvedValue("/chosen/Letter.md")

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness />))
  await vi.waitFor(() => {
    expect(registeredHandlers.has("save-as")).toBe(true)
    expect(registeredHandlers.has("save-to-disk")).toBe(true)
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container.remove()
})

describe("useTauriMenuEvents save flow", () => {
  it("does not adopt the chosen path when the relocate is unsupported", async () => {
    onSaveComplete = async () => false

    await emit("save-as")
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("write_file", {
        path: "/chosen/Letter.md",
        content: "# Letter\n",
      }),
    )

    // A later plain save must open the picker again instead of silently
    // writing to the untracked copy.
    mocks.saveDialog.mockResolvedValue("/chosen-2/Letter.md")
    await emit("save-to-disk")
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("write_file", {
        path: "/chosen-2/Letter.md",
        content: "# Letter\n",
      }),
    )
    expect(mocks.saveDialog).toHaveBeenCalledTimes(2)
  })

  it("adopts the chosen path when the consumer confirms the move", async () => {
    onSaveComplete = async () => true

    await emit("save-as")
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1))

    await emit("save-to-disk")
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2))
    expect(mocks.saveDialog).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenLastCalledWith("write_file", {
      path: "/chosen/Letter.md",
      content: "# Letter\n",
    })
  })

  it("keeps the legacy adoption when the consumer returns nothing", async () => {
    onSaveComplete = async () => undefined

    await emit("save-as")
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1))

    await emit("save-to-disk")
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2))
    expect(mocks.saveDialog).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenLastCalledWith("write_file", {
      path: "/chosen/Letter.md",
      content: "# Letter\n",
    })
  })
})
