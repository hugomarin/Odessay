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

  it("matches the versioned Rust↔TS parity corpus", async () => {
    const cases = [
      {
        markdown: "# Title\n\nBody\n",
        expected: "blake3:1d214c1dbb2fa2352037849f6940df8d404c107b13e0215d3ccc87ffc13d6d43",
      },
      {
        markdown: "# Title\r\n\r\nBody\r\n",
        expected: "blake3:1d214c1dbb2fa2352037849f6940df8d404c107b13e0215d3ccc87ffc13d6d43",
      },
      {
        markdown: "---\nid: test\n---\n\nContent\r\n",
        expected: "blake3:cbc79e12c09e950b1cc84e9d751bfa1c3f3d2d3ff65fdc15ccd7cbcc7460d0b8",
      },
      {
        markdown: "Hello\rworld\r\n",
        expected: "blake3:d1181dae26b0e3028befceb503c34f7b917ac51fe27f84dc501f1d4799d35860",
      },
    ]

    for (const { markdown, expected } of cases) {
      await expect(computeMarkdownContentHash(markdown)).resolves.toBe(expected)
    }
  })
})
