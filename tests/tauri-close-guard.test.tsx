/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-478 follow-up — case 5 made closing a single tab wait for its
 * pending save; nothing previously covered quitting the app or closing the
 * window itself. useTauriCloseGuard must intercept the close, run the
 * caller's flush/settle work, then actually close — without re-triggering
 * itself a second time.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useTauriCloseGuard } from "@/hooks/useTauriCloseGuard"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))

type CloseHandler = (event: { preventDefault: () => void }) => unknown | Promise<unknown>

const mockWindow = vi.hoisted(() => ({
  destroy: vi.fn(async () => {}),
  handler: null as CloseHandler | null,
}))

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: vi.fn(async (handler: CloseHandler) => {
      mockWindow.handler = handler
      return () => {
        mockWindow.handler = null
      }
    }),
    destroy: mockWindow.destroy,
  }),
}))

let container: HTMLDivElement
let root: Root | null = null

function Harness({ onBeforeClose }: { onBeforeClose: () => Promise<unknown> }) {
  useTauriCloseGuard(onBeforeClose)
  return null
}

async function mount(onBeforeClose: () => Promise<unknown>) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<Harness onBeforeClose={onBeforeClose} />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  mockWindow.destroy.mockClear()
  mockWindow.handler = null
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
})

describe("useTauriCloseGuard — ODE-478 follow-up", () => {
  it("prevents the close, runs the flush/settle callback, then destroys the window", async () => {
    let resolveSettle: (() => void) | null = null
    const onBeforeClose = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSettle = resolve
        }),
    )
    await mount(onBeforeClose)
    expect(mockWindow.handler).not.toBeNull()

    const preventDefault = vi.fn()
    let closeEventPromise: unknown
    await act(async () => {
      closeEventPromise = mockWindow.handler?.({ preventDefault })
      await Promise.resolve()
    })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onBeforeClose).toHaveBeenCalledTimes(1)
    // Must not have destroyed the window yet — still waiting on the
    // caller's flush/settle work to actually finish.
    expect(mockWindow.destroy).not.toHaveBeenCalled()

    await act(async () => {
      resolveSettle?.()
      await closeEventPromise
    })

    expect(mockWindow.destroy).toHaveBeenCalledTimes(1)
  })

  it("does not re-enter onBeforeClose if the close event somehow fires again mid-close", async () => {
    let resolveSettle: (() => void) | null = null
    const onBeforeClose = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSettle = resolve
        }),
    )
    await mount(onBeforeClose)

    await act(async () => {
      void mockWindow.handler?.({ preventDefault: vi.fn() })
      void mockWindow.handler?.({ preventDefault: vi.fn() })
      await Promise.resolve()
    })

    expect(onBeforeClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSettle?.()
      await Promise.resolve()
    })
  })

  it("lets a retry through instead of permanently blocking close when destroy() fails (e.g. missing ACL grant)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const onBeforeClose = vi.fn(async () => {})
    mockWindow.destroy.mockRejectedValueOnce(new Error("destroy not allowed by ACL"))
    await mount(onBeforeClose)

    await act(async () => {
      await mockWindow.handler?.({ preventDefault: vi.fn() })
    })

    // First attempt failed to actually close, but must not wedge the guard —
    // a second close request has to be honored, not silently swallowed
    // (ODE-478 follow-up: found live when the destroy permission was missing
    // from the Tauri capabilities file).
    mockWindow.destroy.mockResolvedValueOnce(undefined)
    await act(async () => {
      await mockWindow.handler?.({ preventDefault: vi.fn() })
    })

    expect(onBeforeClose).toHaveBeenCalledTimes(2)
    expect(mockWindow.destroy).toHaveBeenCalledTimes(2)
    errorSpy.mockRestore()
  })
})
