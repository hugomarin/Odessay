import { describe, expect, it } from "vitest"
import {
  canonicalizeMarkdownForContentHash,
  computeMarkdownContentHash,
} from "@/lib/content-hash"

describe("content hash contract", () => {
  it("normalizes CRLF/CR line endings before BLAKE3 hashing", async () => {
    const lf = "# Title\n\nBody\n"
    const crlf = "# Title\r\n\r\nBody\r\n"

    expect(canonicalizeMarkdownForContentHash(crlf)).toBe(lf)
    await expect(computeMarkdownContentHash(lf)).resolves.toBe(
      "blake3:1d214c1dbb2fa2352037849f6940df8d404c107b13e0215d3ccc87ffc13d6d43",
    )
    await expect(computeMarkdownContentHash(crlf)).resolves.toBe(
      "blake3:1d214c1dbb2fa2352037849f6940df8d404c107b13e0215d3ccc87ffc13d6d43",
    )
  })
})
