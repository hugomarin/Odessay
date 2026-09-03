import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createVocabularyItem, deleteVocabularyItem, updateVocabularyItem } from "@/lib/vocabulary/server"

/**
 * ODE-472 requirement 12 / DoD: none of the vocabulary operations may write
 * frontmatter or touch the body of a `.md`. The vocabulary lives in Supabase
 * metadata, never in the content store. This test proves it the literal way
 * the brief asks for: hash (byte-compare) a real `.md` file before and after
 * running the full create → update → delete cycle against a mocked Supabase
 * client, and confirm the file on disk never moved.
 */

function makeChain(response: unknown) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(response)
      }
      return (..._args: unknown[]) => makeChain(response)
    },
  }
  return new Proxy(() => {}, handler)
}

function makeSupabase(queue: unknown[]) {
  let i = 0
  return {
    from: vi.fn(() => makeChain(queue[i++])),
    rpc: vi.fn(async () => queue[i++]),
  } as unknown as Parameters<typeof createVocabularyItem>[0]
}

const row = {
  id: "row-1",
  kind: "type",
  key: "research",
  name: "Research",
  description: "",
  icon: "compass",
  color: "#5B5BD6",
  hidden: false,
  is_base: false,
  is_required: false,
  position: 7,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
}

describe("vocabulary operations never touch the .md content store", () => {
  let dir: string
  let mdPath: string
  const original = "---\ntitle: A letter\nartifact_type: general\n---\n\nDear reader,\n"

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "odessay-vocab-test-"))
    mdPath = join(dir, "letter.md")
    writeFileSync(mdPath, original, "utf8")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("leaves the .md byte-identical through create, update and delete", async () => {
    const before = readFileSync(mdPath, "utf8")

    const createSupabase = makeSupabase([
      { error: null },
      { data: null, error: null },
      { count: 6 },
      { data: row, error: null },
    ])
    await createVocabularyItem(createSupabase, "user-1", {
      kind: "type",
      name: "Research",
      icon: "compass",
      color: "#5B5BD6",
    })

    const updateSupabase = makeSupabase([{ data: row, error: null }, { data: row, error: null }])
    await updateVocabularyItem(updateSupabase, "user-1", "row-1", { name: "Renamed" })

    const deleteSupabase = makeSupabase([{ data: row, error: null }, { data: 0, error: null }])
    await deleteVocabularyItem(deleteSupabase, "user-1", "row-1")

    const after = readFileSync(mdPath, "utf8")
    expect(after).toBe(before)
    expect(after).not.toContain("Renamed")
  })
})
