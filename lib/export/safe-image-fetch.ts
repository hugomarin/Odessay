/**
 * ODE-522 — SSRF-hardened image fetch for document export.
 *
 * The DOCX and PDF exporters both need to resolve a document-controlled
 * image URL and embed the bytes. Neither may use a plain `fetch(src)`: the
 * audit reproduced a redirect to loopback and recovered non-image bytes.
 *
 * This module has to run in two very different places: the server export
 * route (`app/api/writings/[id]/export/route.ts`, real Node) AND the
 * desktop app's local export path (`lib/services/desktop/
 * filesystem-document-service.ts`), which this project bundles with
 * `next build` in `output: "export"` mode for Tauri — a browser-like
 * webview with no Node built-ins at all. `to-docx.ts`/`to-pdf.tsx` are
 * shared between both, so this file cannot import `node:https`/`node:dns`/
 * `node:net` (there is no code-split boundary in this repo that would keep
 * those out of the desktop bundle — see the module-graph trace this issue's
 * implementation confirmed). Everything here is built on the standard
 * `fetch` API instead, which both environments provide.
 *
 * Trade-off this forces, documented rather than silently accepted: a
 * DNS-resolution-time check (the strongest defense against DNS rebinding)
 * needs a custom socket-connect hook that neither browser `fetch` nor
 * cross-platform Node code exposes. What this module *does* still enforce,
 * in both environments:
 *  - HTTPS only.
 *  - A literal IP address anywhere in the URL or in a redirect target is
 *    checked against the full private/loopback/link-local/multicast
 *    blocklist for IPv4 and IPv6 — this is exactly the audit's own
 *    reproduction ("redirected to loopback").
 *  - Redirects are never followed automatically (`redirect: "manual"`) and
 *    are validated one hop at a time, up to a fixed limit. In a browser
 *    fetch, a manual redirect to a different origin comes back as an opaque
 *    response with no readable Location header — that case is denied
 *    outright rather than guessed at.
 *  - The response body is read via a streaming reader with a running byte
 *    counter, aborted before the cap is exceeded rather than after full
 *    buffering.
 *  - Content-Type is used only to fail fast, never to accept — real
 *    acceptance requires the response bytes to match a known image
 *    signature.
 *  - No credentials are ever attached (`credentials: "omit"`, no cookies,
 *    no Authorization header).
 */

export type SafeImageFormat = "png" | "jpg" | "gif" | "bmp"

export type SafeImageFetchResult =
  | { ok: true; data: Uint8Array; contentType: string; format: SafeImageFormat }
  | { ok: false; reason: string }

const MAX_REDIRECTS = 5
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MiB — generous for a document image, bounded regardless
const REQUEST_TIMEOUT_MS = 10_000

const ALLOWED_CONTENT_TYPES: Record<string, SafeImageFormat> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
}

// Requirement 4: never trust Content-Type alone. Sniff real magic bytes.
const MAGIC_BYTE_CHECKS: { format: SafeImageFormat; matches: (buf: Uint8Array) => boolean }[] = [
  {
    format: "png",
    matches: (b) =>
      b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d,
  },
  { format: "jpg", matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    format: "gif",
    matches: (b) => b.length >= 4 && String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === "GIF8",
  },
  { format: "bmp", matches: (b) => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d },
]

function sniffImageFormat(buf: Uint8Array): SafeImageFormat | null {
  for (const check of MAGIC_BYTE_CHECKS) {
    if (check.matches(buf)) return check.format
  }
  return null
}

// ─── Pure IPv4/IPv6 literal parsing and range classification ─────────────────
// No `node:net`/`node:dns` — this has to run in a browser/webview bundle too.

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n < 0 || n > 255) return null
    result = (result << 8) | n
  }
  return result >>> 0
}

const IPV4_DISALLOWED_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3], // covers multicast (224/4) through reserved (240/4) and broadcast
]

function isDisallowedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip)
  if (value === null) return true // unparsable — fail closed
  return IPV4_DISALLOWED_RANGES.some(([base, prefix]) => {
    const baseValue = ipv4ToInt(base)
    if (baseValue === null) return false
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
    return (value & mask) === (baseValue & mask)
  })
}

/**
 * Parses a normalized IPv6 literal (brackets already stripped) into a
 * 128-bit BigInt, or null if the string is not a well-formed IPv6 address.
 * This doubles as the format validator — there is no separate `net.isIPv6`
 * available cross-platform, so "parses cleanly" is the definition of valid.
 */
function ipv6ToBigInt(ip: string): bigint | null {
  if (!ip || ip.includes(":::") || (ip.match(/::/g)?.length ?? 0) > 1) return null

  let head = ip
  let tail = ""
  if (ip.includes("::")) {
    const parts = ip.split("::")
    head = parts[0] ?? ""
    tail = parts[1] ?? ""
  } else if (ip.split(":").length !== 8) {
    return null // no compression, so it must spell out all 8 groups
  }

  const headGroups = head.length ? head.split(":") : []
  const tailGroups = tail.length ? tail.split(":") : []

  // An embedded IPv4 tail (e.g. ::ffff:1.2.3.4) appears as the last group.
  const expand = (groups: string[]): string[] | null => {
    const last = groups.at(-1)
    if (last && last.includes(".")) {
      const v4 = ipv4ToInt(last)
      if (v4 === null) return null
      const hi = (v4 >>> 16).toString(16)
      const lo = (v4 & 0xffff).toString(16)
      return [...groups.slice(0, -1), hi, lo]
    }
    return groups
  }

  const expandedHead = expand(headGroups)
  const expandedTail = expand(tailGroups)
  if (expandedHead === null || expandedTail === null) return null

  const missing = 8 - (expandedHead.length + expandedTail.length)
  if (missing < 0) return null
  const allGroups = [...expandedHead, ...Array(missing).fill("0"), ...expandedTail]
  if (allGroups.length !== 8) return null

  let value = 0n
  for (const group of allGroups) {
    if (!/^[0-9a-fA-F]{0,4}$/.test(group)) return null
    const n = group === "" ? 0 : Number.parseInt(group, 16)
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null
    value = (value << 16n) | BigInt(n)
  }
  return value
}

const IPV6_DISALLOWED_RANGES: [string, bigint][] = [
  ["::", 128n], // unspecified
  ["::1", 128n], // loopback
  ["fe80::", 10n], // link-local
  ["fc00::", 7n], // unique local
  ["ff00::", 8n], // multicast
  ["2001:db8::", 32n], // documentation
]

function maskForPrefix(value: bigint, prefixLength: bigint): bigint {
  if (prefixLength <= 0n) return 0n
  return (value >> (128n - prefixLength)) << (128n - prefixLength)
}

function isDisallowedIpv6(ip: string): boolean {
  const value = ipv6ToBigInt(ip)
  if (value === null) return true // unparsable — fail closed

  // IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96) embed a real IPv4
  // address in the low 32 bits — unwrap and re-check against IPv4 rules so
  // an attacker cannot bypass the IPv4 blocklist through an IPv6 wrapper.
  const ipv4MappedBase = ipv6ToBigInt("::ffff:0:0")
  const nat64Base = ipv6ToBigInt("64:ff9b::")
  const embedsIpv4 =
    (ipv4MappedBase !== null && maskForPrefix(value, 96n) === maskForPrefix(ipv4MappedBase, 96n)) ||
    (nat64Base !== null && maskForPrefix(value, 96n) === maskForPrefix(nat64Base, 96n))

  if (embedsIpv4) {
    const embeddedV4 = value & 0xffffffffn
    const octets = [
      Number((embeddedV4 >> 24n) & 0xffn),
      Number((embeddedV4 >> 16n) & 0xffn),
      Number((embeddedV4 >> 8n) & 0xffn),
      Number(embeddedV4 & 0xffn),
    ]
    if (isDisallowedIpv4(octets.join("."))) return true
  }

  return IPV6_DISALLOWED_RANGES.some(([baseAddress, prefixLength]) => {
    const base = ipv6ToBigInt(baseAddress)
    if (base === null) return false
    return maskForPrefix(value, prefixLength) === maskForPrefix(base, prefixLength)
  })
}

/** Exported for direct unit testing of the IPv4/IPv6 range classification. */
export function isPubliclyRoutableAddress(address: string, family: 4 | 6): boolean {
  return family === 4 ? !isDisallowedIpv4(address) : !isDisallowedIpv6(address)
}

/**
 * If `hostname` is itself an IP literal (as opposed to a name that needs DNS
 * resolution), returns its family; otherwise 0. A bracketed IPv6 literal
 * (as `URL.hostname` renders it, e.g. "[::1]") is unwrapped first.
 */
function parseIpLiteral(hostname: string): 4 | 6 | 0 {
  const unwrapped = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
  if (ipv4ToInt(unwrapped) !== null) return 4
  if (ipv6ToBigInt(unwrapped) !== null) return 6
  return 0
}

/**
 * Denies a URL whose host is a literal IP in a disallowed range. This is
 * necessarily hostname-only (no DNS-resolution-time check is available
 * across both the server and the browser/webview runtimes this module
 * shares — see the module doc comment), but it is exactly the audit's own
 * reproduction: a redirect straight to a loopback/private literal address.
 */
function isUrlToDisallowedLiteralHost(url: URL): boolean {
  const family = parseIpLiteral(url.hostname)
  if (!family) return false
  const address = family === 6 ? url.hostname.slice(1, -1) : url.hostname
  return !isPubliclyRoutableAddress(address, family)
}

type SingleFetchResult =
  | { kind: "redirect"; location: string }
  | { kind: "success"; data: Uint8Array; contentType: string }
  | { kind: "error"; reason: string }

async function fetchOnce(urlString: string): Promise<SingleFetchResult> {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return { kind: "error", reason: "malformed URL" }
  }

  if (url.protocol !== "https:") {
    return { kind: "error", reason: "only https URLs are allowed" }
  }

  if (isUrlToDisallowedLiteralHost(url)) {
    return { kind: "error", reason: "target address is not publicly routable" }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      credentials: "omit", // requirement 5: never forward cookies/credentials
      referrerPolicy: "no-referrer",
      headers: { accept: "image/*" }, // no cookies, no Authorization — the entire header set
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)
    const isAbort = error instanceof Error && error.name === "AbortError"
    return { kind: "error", reason: isAbort ? "request timed out" : "network error" }
  }
  clearTimeout(timeoutId)

  const status = response.status
  const isRedirectish = status === 0 || (status >= 300 && status < 400)
  if (isRedirectish) {
    const location = response.headers.get("location")
    if (!location) {
      // An opaque redirect (status 0, `type: "opaqueredirect"`) is what a
      // browser hands back for a cross-origin manual redirect — the target
      // is deliberately unreadable from here, so it cannot be validated,
      // so it is denied rather than guessed at.
      return { kind: "error", reason: "redirect target could not be validated" }
    }
    return { kind: "redirect", location: new URL(location, url).toString() }
  }

  if (status < 200 || status >= 300) {
    return { kind: "error", reason: `unexpected status ${status}` }
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
  if (!ALLOWED_CONTENT_TYPES[contentType]) {
    return { kind: "error", reason: `disallowed content type: ${contentType || "unknown"}` }
  }

  if (!response.body) {
    return { kind: "error", reason: "empty response body" }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.length
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {})
      return { kind: "error", reason: "response exceeded the size limit" }
    }
    chunks.push(value)
  }

  const data = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }

  return { kind: "success", data, contentType }
}

/**
 * Fetches and validates one document image URL end to end. Never throws —
 * every failure mode (disallowed destination, redirect loop, oversize,
 * timeout, wrong content type, bytes that don't decode as an image) comes
 * back as `{ ok: false, reason }` for the caller to render as a bounded
 * fallback, never as a partially-buffered response.
 */
export async function fetchImageSafely(url: string): Promise<SafeImageFetchResult> {
  let currentUrl = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const result = await fetchOnce(currentUrl)

    if (result.kind === "error") return { ok: false, reason: result.reason }

    if (result.kind === "redirect") {
      if (hop === MAX_REDIRECTS) return { ok: false, reason: "too many redirects" }
      currentUrl = result.location
      continue
    }

    const sniffed = sniffImageFormat(result.data)
    if (!sniffed) {
      return { ok: false, reason: "response body is not a recognizable image" }
    }

    return { ok: true, data: result.data, contentType: result.contentType, format: sniffed }
  }

  return { ok: false, reason: "too many redirects" }
}

/**
 * Runs `task` over `items` with at most `concurrency` in flight at once —
 * the bounded alternative to `Promise.all(items.map(task))`, which the
 * Performance Architecture explicitly rejects for a per-document image
 * fetch fan-out.
 */
export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await task(items[index] as T, index)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
