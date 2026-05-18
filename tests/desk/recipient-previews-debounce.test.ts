import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { debounce } from "@/lib/utils/debounce"

describe("recipient previews debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("coalesces 30 rapid localDB changes into 1 refetch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })
    global.fetch = fetchSpy

    // Simulate the debounced callback pattern from DeskPage
    const debouncedFetch = debounce(async () => {
      await fetch("/api/writings/shares?ids=1,2,3")
    }, 100, { leading: false, trailing: true })

    // Simulate 30 rapid localDB change events
    for (let i = 0; i < 30; i++) {
      debouncedFetch()
    }

    // Before timer fires, fetch should not have been called
    expect(fetchSpy).toHaveBeenCalledTimes(0)

    // Advance past the debounce window
    vi.advanceTimersByTime(150)

    // Should have been called exactly once (trailing)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith("/api/writings/shares?ids=1,2,3")
  })

  it("fires only once for an isolated write after the debounce window", () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100, { leading: false, trailing: true })

    debounced()
    expect(fn).toHaveBeenCalledTimes(0)

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)

    // After the window expires, a new call should trigger a new timer
    debounced()
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("supports leading + trailing mode for immediate response", () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100, { leading: true, trailing: true })

    // First call executes immediately
    debounced("a")
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith("a")

    // Subsequent calls within window don't execute
    debounced("b")
    debounced("c")
    expect(fn).toHaveBeenCalledTimes(1)

    // After window, trailing executes with last args
    vi.advanceTimersByTime(150)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith("c")

    // New isolated call executes immediately again
    debounced("d")
    expect(fn).toHaveBeenCalledTimes(3)
    expect(fn).toHaveBeenLastCalledWith("d")

    // No trailing for isolated call
    vi.advanceTimersByTime(150)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("cancels pending trailing execution on cancel()", () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100, { leading: false, trailing: true })

    debounced()
    debounced.cancel()

    vi.advanceTimersByTime(150)
    expect(fn).toHaveBeenCalledTimes(0)
  })

  it("propagates the last args on trailing execution", () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100, { leading: false, trailing: true })

    debounced("first")
    debounced("second")
    debounced("third")

    vi.advanceTimersByTime(150)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith("third")
  })
})
