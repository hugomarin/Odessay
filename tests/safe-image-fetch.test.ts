import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchImageSafely, isPubliclyRoutableAddress, mapWithConcurrencyLimit } from "@/lib/export/safe-image-fetch"

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function streamOf(bytes: Uint8Array, chunkSize = bytes.length): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const next = bytes.subarray(offset, offset + chunkSize)
      offset += chunkSize
      controller.enqueue(next)
    },
  })
}

function fakeResponse(init: {
  status?: number
  headers?: Record<string, string>
  body?: ReadableStream<Uint8Array> | null
}): Response {
  return {
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    body: init.body ?? null,
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── IP range classification (ODE-522) ────────────────────────────────────────
// The bit-arithmetic here is the highest-risk-of-a-typo part of the fix — a
// wrong mask silently either blocks everything or nothing.

describe("isPubliclyRoutableAddress — IPv4", () => {
  it.each([
    ["127.0.0.1", false], // loopback
    ["127.255.255.255", false], // loopback, high end of /8
    ["10.0.0.1", false], // RFC1918 private
    ["10.255.255.255", false],
    ["172.16.0.1", false], // RFC1918 private
    ["172.31.255.255", false],
    ["172.15.255.255", true], // just outside the 172.16.0.0/12 block
    ["172.32.0.0", true], // just outside the 172.16.0.0/12 block
    ["192.168.0.1", false], // RFC1918 private
    ["192.168.255.255", false],
    ["169.254.1.1", false], // link-local
    ["100.64.0.1", false], // CGNAT shared address space
    ["100.127.255.255", false],
    ["100.63.255.255", true], // just outside 100.64.0.0/10
    ["0.0.0.0", false],
    ["255.255.255.255", false], // broadcast
    ["224.0.0.1", false], // multicast
    ["192.0.2.1", false], // TEST-NET-1 documentation
    ["8.8.8.8", true], // public — Google DNS
    ["1.1.1.1", true], // public — Cloudflare DNS
    ["93.184.216.34", true], // public — example.com's historical address
  ])("%s -> publicly routable = %s", (address, expected) => {
    expect(isPubliclyRoutableAddress(address, 4)).toBe(expected)
  })
})

describe("isPubliclyRoutableAddress — IPv6", () => {
  it.each([
    ["::1", false], // loopback
    ["::", false], // unspecified
    ["fe80::1", false], // link-local
    ["fc00::1", false], // unique local
    ["fd12:3456:789a::1", false], // unique local, fd.. within fc00::/7
    ["ff02::1", false], // multicast
    ["2001:db8::1", false], // documentation range
    ["::ffff:127.0.0.1", false], // IPv4-mapped loopback — must unwrap
    ["::ffff:10.0.0.1", false], // IPv4-mapped private — must unwrap
    ["::ffff:8.8.8.8", true], // IPv4-mapped public — must unwrap and allow
    ["2606:4700:4700::1111", true], // public — Cloudflare DNS
    ["2001:4860:4860::8888", true], // public — Google DNS
  ])("%s -> publicly routable = %s", (address, expected) => {
    expect(isPubliclyRoutableAddress(address, 6)).toBe(expected)
  })
})

// ─── fetchImageSafely — literal-IP hosts, denied before any fetch ────────────

describe("fetchImageSafely — literal IP hosts are rejected without a network call", () => {
  it.each([
    "https://127.0.0.1/image.png",
    "https://10.0.0.5/image.png",
    "https://169.254.169.254/latest/meta-data/", // the classic cloud-metadata SSRF target
    "https://[::1]/image.png",
    "https://[fc00::1]/image.png",
  ])("%s is denied", async (url) => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const result = await fetchImageSafely(url)

    expect(result.ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects non-https schemes before any network activity", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const result = await fetchImageSafely("http://example.com/image.png")

    expect(result).toEqual({ ok: false, reason: "only https URLs are allowed" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects a malformed URL", async () => {
    const result = await fetchImageSafely("not a url")
    expect(result.ok).toBe(false)
  })
})

// ─── fetchImageSafely — the happy path and content validation ───────────────

describe("fetchImageSafely — success and content validation", () => {
  it("accepts a real image response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ headers: { "content-type": "image/png" }, body: streamOf(PNG_BYTES) })),
    )

    const result = await fetchImageSafely("https://example.com/image.png")

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.format).toBe("png")
      expect(Array.from(result.data)).toEqual(Array.from(PNG_BYTES))
    }
  })

  it("denies a disallowed content type without ever acquiring a body reader", async () => {
    let readerAcquired = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })
    // getReader() is the actual call site the production code uses to start
    // consuming a body — a stream can prefetch into its own internal queue
    // regardless of whether anything ever reads from it, so that isn't a
    // reliable signal; whether the code under test ever locks the stream is.
    const originalGetReader = body.getReader.bind(body)
    ;(body as { getReader: unknown }).getReader = (...args: unknown[]) => {
      readerAcquired = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only spy over an overloaded DOM method
      return (originalGetReader as any)(...args)
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ headers: { "content-type": "application/octet-stream" }, body })),
    )

    const result = await fetchImageSafely("https://example.com/file.bin")

    expect(result).toEqual({ ok: false, reason: "disallowed content type: application/octet-stream" })
    expect(readerAcquired).toBe(false)
  })

  it("denies a response that claims image/png but is not really a PNG (mislabeled content)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          headers: { "content-type": "image/png" },
          body: streamOf(new TextEncoder().encode("<html>not an image</html>")),
        }),
      ),
    )

    const result = await fetchImageSafely("https://example.com/mislabeled.png")

    expect(result).toEqual({ ok: false, reason: "response body is not a recognizable image" })
  })

  it("denies a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ status: 404 })))

    const result = await fetchImageSafely("https://example.com/missing.png")

    expect(result).toEqual({ ok: false, reason: "unexpected status 404" })
  })

  it("denies a network-level fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND")
      }),
    )

    const result = await fetchImageSafely("https://example.com/image.png")

    expect(result).toEqual({ ok: false, reason: "network error" })
  })
})

// ─── fetchImageSafely — redirects ─────────────────────────────────────────────

describe("fetchImageSafely — redirects are followed manually and re-validated per hop", () => {
  it("follows a legitimate redirect chain to a successful image", async () => {
    const calls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url)
        if (url === "https://example.com/original.png") {
          return fakeResponse({ status: 302, headers: { location: "https://cdn.example.com/final.png" } })
        }
        return fakeResponse({ headers: { "content-type": "image/png" }, body: streamOf(PNG_BYTES) })
      }),
    )

    const result = await fetchImageSafely("https://example.com/original.png")

    expect(result.ok).toBe(true)
    expect(calls).toEqual(["https://example.com/original.png", "https://cdn.example.com/final.png"])
  })

  it("denies a redirect whose target is a disallowed literal IP — the audit's own reproduction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://example.com/original.png") {
          return fakeResponse({ status: 302, headers: { location: "https://127.0.0.1/evil" } })
        }
        throw new Error("should never reach the redirect target")
      }),
    )

    const result = await fetchImageSafely("https://example.com/original.png")

    expect(result).toEqual({ ok: false, reason: "target address is not publicly routable" })
  })

  it("denies an opaque redirect it cannot read the target of (the browser/webview case)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ status: 0 })), // no readable Location header
    )

    const result = await fetchImageSafely("https://example.com/image.png")

    expect(result).toEqual({ ok: false, reason: "redirect target could not be validated" })
  })

  it("gives up after too many redirects", async () => {
    let hop = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        hop += 1
        return fakeResponse({ status: 302, headers: { location: `https://example.com/hop-${hop}.png` } })
      }),
    )

    const result = await fetchImageSafely("https://example.com/start.png")

    expect(result).toEqual({ ok: false, reason: "too many redirects" })
  })
})

// ─── fetchImageSafely — size cap enforced during streaming ───────────────────
// Named explicitly as a failure mode to avoid: "reading the full body before
// enforcing size". Chunks past the cap must never be read.

describe("fetchImageSafely — size cap (ODE-522)", () => {
  it("aborts as soon as the byte ceiling is crossed, and cancels the stream instead of draining it", async () => {
    let cancelled = false
    let chunksEnqueued = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // An unbounded source: if the consumer never stops asking, this
        // would run forever. 6 MiB per chunk: the second one crosses the
        // 10 MiB ceiling.
        chunksEnqueued += 1
        controller.enqueue(new Uint8Array(6 * 1024 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ headers: { "content-type": "image/png" }, body: stream })),
    )

    const result = await fetchImageSafely("https://example.com/huge.png")

    expect(result).toEqual({ ok: false, reason: "response exceeded the size limit" })
    expect(cancelled).toBe(true)
    // Bounded, not unbounded: the source could supply chunks forever, but
    // consumption stopped within a couple of chunks of crossing the cap
    // rather than draining it to completion.
    expect(chunksEnqueued).toBeLessThan(5)
  })
})

// ─── mapWithConcurrencyLimit ──────────────────────────────────────────────────

describe("mapWithConcurrencyLimit", () => {
  it("never runs more than the given concurrency at once", async () => {
    let active = 0
    let peak = 0

    await mapWithConcurrencyLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (item) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return item * 2
    })

    expect(peak).toBeLessThanOrEqual(3)
  })

  it("preserves result order regardless of completion order", async () => {
    const results = await mapWithConcurrencyLimit([30, 10, 20], 3, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay))
      return delay
    })

    expect(results).toEqual([30, 10, 20])
  })

  it("returns an empty array for an empty input", async () => {
    const results = await mapWithConcurrencyLimit([], 4, async (item) => item)
    expect(results).toEqual([])
  })
})
