import { beforeEach, describe, expect, it, vi } from "vitest"
import { emitSyncStatusChange, subscribeToSyncStatusChanges } from "../lib/sync/events"

type Listener = (event: Event) => void

beforeEach(() => {
  const listeners = new Map<string, Set<Listener>>()

  class MockCustomEvent<T> extends Event {
    detail: T

    constructor(type: string, init?: { detail: T }) {
      super(type)
      this.detail = init?.detail as T
    }
  }

  const windowMock = {
    CustomEvent: MockCustomEvent,
    addEventListener: vi.fn((name: string, listener: Listener) => {
      const current = listeners.get(name) ?? new Set<Listener>()
      current.add(listener)
      listeners.set(name, current)
    }),
    removeEventListener: vi.fn((name: string, listener: Listener) => {
      const current = listeners.get(name)

      if (!current) {
        return
      }

      current.delete(listener)
    }),
    dispatchEvent: vi.fn((event: Event) => {
      const current = listeners.get(event.type)

      if (!current) {
        return true
      }

      current.forEach((listener) => listener(event))
      return true
    }),
  }

  vi.stubGlobal("window", windowMock)
})

describe("sync status events", () => {
  it("notifies listeners and supports unsubscribe", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToSyncStatusChanges(listener)

    emitSyncStatusChange({
      writingId: "writing-1",
      status: "pending",
    })

    expect(listener).toHaveBeenCalledWith({
      writingId: "writing-1",
      status: "pending",
    })

    unsubscribe()

    emitSyncStatusChange({
      writingId: "writing-1",
      status: "synced",
    })

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
