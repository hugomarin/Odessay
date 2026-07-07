import { beforeEach, describe, expect, it, vi } from "vitest"
import type { subscribeMenuAction as SubscribeMenuActionType } from "@/lib/services/desktop/menu-event-bus"

const listenMock = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}))

describe("menu-event-bus", () => {
  let subscribeMenuAction: typeof SubscribeMenuActionType
  let registeredHandlers: Map<string, () => void>

  beforeEach(async () => {
    vi.resetModules()
    listenMock.mockReset()
    registeredHandlers = new Map()

    listenMock.mockImplementation(async (channel: string, handler: () => void) => {
      const action = channel.replace("menu:", "")
      registeredHandlers.set(action, handler)
      return () => {
        registeredHandlers.delete(action)
      }
    })

    const mod = await import("@/lib/services/desktop/menu-event-bus")
    subscribeMenuAction = mod.subscribeMenuAction
  })

  function emit(action: string) {
    registeredHandlers.get(action)?.()
  }

  it("registers a Tauri listener only once per action", async () => {
    const handlerA = vi.fn()
    const handlerB = vi.fn()

    subscribeMenuAction("bold", handlerA)
    subscribeMenuAction("bold", handlerB)

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1))
    expect(listenMock).toHaveBeenCalledWith("menu:bold", expect.any(Function))
  })

  it("delivers events to the most recent subscriber (stack semantics)", async () => {
    const handlerA = vi.fn()
    const handlerB = vi.fn()

    subscribeMenuAction("italic", handlerA)
    subscribeMenuAction("italic", handlerB)

    await vi.waitFor(() => expect(registeredHandlers.has("italic")).toBe(true))
    emit("italic")

    expect(handlerB).toHaveBeenCalledTimes(1)
    expect(handlerA).not.toHaveBeenCalled()
  })

  it("restores the previous subscriber when the active one unsubscribes", async () => {
    const handlerA = vi.fn()
    const handlerB = vi.fn()

    const unsubscribeA = subscribeMenuAction("bold", handlerA)
    const unsubscribeB = subscribeMenuAction("bold", handlerB)

    await vi.waitFor(() => expect(registeredHandlers.has("bold")).toBe(true))

    emit("bold")
    expect(handlerB).toHaveBeenCalledTimes(1)
    expect(handlerA).not.toHaveBeenCalled()

    unsubscribeB()
    emit("bold")

    expect(handlerA).toHaveBeenCalledTimes(1)
    expect(handlerB).toHaveBeenCalledTimes(1)

    unsubscribeA()
  })

  it("does not register duplicate listeners when the same handler subscribes twice", async () => {
    const handler = vi.fn()

    subscribeMenuAction("save-to-disk", handler)
    subscribeMenuAction("save-to-disk", handler)

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1))
    emit("save-to-disk")

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("retries registration on the next subscribe after a failed listen", async () => {
    listenMock.mockRejectedValueOnce(new Error("ipc not ready"))
    listenMock.mockImplementationOnce(async (channel: string, handler: () => void) => {
      const action = channel.replace("menu:", "")
      registeredHandlers.set(action, handler)
      return () => registeredHandlers.delete(action)
    })

    const handlerA = vi.fn()
    const handlerB = vi.fn()

    subscribeMenuAction("open-file", handlerA)

    // Wait for the first, failed registration attempt to settle.
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1))

    expect(registeredHandlers.has("open-file")).toBe(false)

    subscribeMenuAction("open-file", handlerB)

    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(2))
    expect(registeredHandlers.has("open-file")).toBe(true)

    emit("open-file")
    expect(handlerA).not.toHaveBeenCalled()
    expect(handlerB).toHaveBeenCalledTimes(1)
  })

  it("supports async handlers and catches rejections without throwing", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("async oops"))

    subscribeMenuAction("new-file", handler)

    await vi.waitFor(() => expect(registeredHandlers.has("new-file")).toBe(true))

    expect(() => emit("new-file")).not.toThrow()
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
  })

  it("is safe to unsubscribe a handler that was never subscribed", async () => {
    const handler = vi.fn()

    const unsubscribe = subscribeMenuAction("save-as", handler)
    unsubscribe()

    // Calling unsubscribe again should not throw.
    expect(() => unsubscribe()).not.toThrow()
  })
})
