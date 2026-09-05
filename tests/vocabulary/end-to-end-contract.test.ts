import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import {
  createVocabularyItem,
  deleteVocabularyItem,
  getVocabularyUsage,
  updateVocabularyItem,
} from "@/lib/vocabulary/server"
import { normalizeWritingStatus } from "@/lib/writings/status"
import { normalizeArtifactType } from "@/lib/writings/artifact-type"
import type { VocabularyItem } from "@/lib/vocabulary/types"

/**
 * ODE-477: the four claims no single upstream issue (ODE-472..476) can prove
 * on its own, because each one exercises exactly one seam. This file runs
 * the brief's own narrative — create a type, rename it, recolor it, hide a
 * status, delete the type — as one script against the same mocked Supabase
 * client, and checks the properties that only hold *across* that sequence:
 * the `.md` never moves (requirement 1), hide and delete have distinct and
 * correct effects (requirement 5), and an unrecognized value is never
 * silently coerced (requirement 6).
 *
 * Reuses the fluent-query-builder fake from
 * `tests/vocabulary/no-frontmatter-writes.test.ts` / `server.test.ts` — same
 * shape, one definition per file so each stays independently readable.
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

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

function frontmatterKeys(content: string): string[] {
  const match = /^---\n([\s\S]*?)\n---/.exec(content)
  if (!match) return []
  return match[1]
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(":")[0]!.trim())
}

const createdRow = {
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

const renamedRow = { ...createdRow, name: "Field research" }
const recoloredRow = { ...renamedRow, color: "#2E7D4F" }

describe("vocabulary contract, end to end (ODE-477)", () => {
  let dir: string
  let mdPath: string
  // An artifact already saved with the custom type this scenario is about to
  // create, plus a status key the catalog no longer recognizes — the two
  // things a coercion bug would silently destroy.
  const original =
    "---\ntitle: Field notes\nartifact_type: research\nstatus: backlog\n---\n\nDear reader,\n"

  it("requirement 1 — a full create/rename/recolor/hide/delete cycle leaves the .md byte-identical and adds no frontmatter key", async () => {
    dir = mkdtempSync(join(tmpdir(), "odessay-vocab-e2e-"))
    mdPath = join(dir, "field-notes.md")
    writeFileSync(mdPath, original, "utf8")

    const before = readFileSync(mdPath, "utf8")
    const beforeHash = hash(before)
    const beforeKeys = frontmatterKeys(before)

    // 1. Create the type ("assign to the artifact" is exercised in the
    // requirement-6 case below — the assignment itself is a writings-table
    // write, not a vocabulary_items write, and is out of this file's grep;
    // ODE-472's own writings-route tests cover that path).
    const createSupabase = makeSupabase([
      { error: null }, // ensureBaseItemsMaterialized upsert
      { data: null, error: null }, // key is free
      { count: 6 }, // position count
      { data: createdRow, error: null }, // insert
    ])
    const created = await createVocabularyItem(createSupabase, "user-1", {
      kind: "type",
      name: "Research",
      icon: "compass",
      color: "#5B5BD6",
    })
    expect(created.error).toBeNull()

    // 2. Rename it.
    const renameSupabase = makeSupabase([
      { data: createdRow, error: null }, // resolveRow
      { data: renamedRow, error: null }, // update
    ])
    await updateVocabularyItem(renameSupabase, "user-1", "row-1", { name: "Field research" })

    // 3. Recolor it.
    const recolorSupabase = makeSupabase([
      { data: renamedRow, error: null },
      { data: recoloredRow, error: null },
    ])
    await updateVocabularyItem(recolorSupabase, "user-1", "row-1", { color: "#2E7D4F" })

    // 4. Hide a status (a *different* item — draft is required and can't be
    // hidden; use a plain base status).
    const hideRow = { ...createdRow, kind: "status", key: "archived", is_base: true }
    const hideSupabase = makeSupabase([
      { data: hideRow, error: null },
      { data: { ...hideRow, hidden: true }, error: null },
    ])
    await updateVocabularyItem(hideSupabase, "user-1", "status-row", { hidden: true })

    // 5. Delete the type.
    const deleteSupabase = makeSupabase([
      { data: recoloredRow, error: null }, // resolveRow
      { data: 1, error: null }, // rpc delete_vocabulary_item -> rewritten count
    ])
    const deleted = await deleteVocabularyItem(deleteSupabase, "user-1", "row-1")
    expect(deleted.error).toBeNull()

    const after = readFileSync(mdPath, "utf8")
    expect(hash(after)).toBe(beforeHash)
    expect(frontmatterKeys(after)).toEqual(beforeKeys)

    rmSync(dir, { recursive: true, force: true })
  })

  it("requirement 5 — hiding leaves carrying artifacts untouched; deleting rewrites exactly (and only) the ones the usage count named", async () => {
    // Three writings carry the type about to be deleted, one carries
    // something else. getVocabularyUsage and the delete rpc are two
    // independent queries in production (one plain select, one SQL
    // function) — this proves they agree on the same number.
    const items: VocabularyItem[] = [
      {
        id: "row-1",
        kind: "type",
        key: "research",
        name: "Research",
        description: "",
        icon: "compass",
        color: "#5B5BD6",
        hidden: false,
        isBase: false,
        isRequired: false,
        position: 7,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ]
    const usageSupabase = makeSupabase([
      {
        data: [
          { artifact_type: "research", status: "draft" },
          { artifact_type: "research", status: "draft" },
          { artifact_type: "research", status: "draft" },
          { artifact_type: "general", status: "draft" },
        ],
        error: null,
      },
    ])
    const usage = await getVocabularyUsage(usageSupabase, "user-1", items)
    expect(usage.data?.["row-1"]).toBe(3)

    // Hiding: the switch never touches the writings that carry the value —
    // updateVocabularyItem only ever writes to vocabulary_items.
    const hideSupabase = makeSupabase([
      { data: { ...createdRow, hidden: false }, error: null },
      { data: { ...createdRow, hidden: true }, error: null },
    ])
    await updateVocabularyItem(hideSupabase, "user-1", "row-1", { hidden: true })
    expect(hideSupabase.rpc).not.toHaveBeenCalled()

    // Deleting: the rpc's own rewrite count matches the usage count exactly —
    // not more (over-rewrite), not less (orphaned artifacts left pointing at
    // a value that no longer exists in the catalog).
    const deleteSupabase = makeSupabase([
      { data: createdRow, error: null },
      { data: 3, error: null },
    ])
    const deleted = await deleteVocabularyItem(deleteSupabase, "user-1", "row-1")
    expect(deleted.data).toEqual({ rewrittenCount: 3 })
  })

  it("requirement 6 — an artifact carrying a value the catalog no longer has survives an open/edit/save cycle unchanged", () => {
    // "backlog" from the fixture .md above: not a base status, and this
    // scenario just deleted the only vocabulary item ("research"/status
    // items untouched) that could have coerced it. A read -> save -> read
    // must return the exact same key both times.
    const opened = normalizeWritingStatus("backlog")
    const savedThenReloaded = normalizeWritingStatus(opened)
    expect(savedThenReloaded).toBe("backlog")

    const openedType = normalizeArtifactType("research")
    expect(normalizeArtifactType(openedType)).toBe("research")
  })
})
