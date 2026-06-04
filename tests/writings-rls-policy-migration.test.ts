import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260603175221_fix_writings_correspondence_rls_subquery.sql",
)

describe("ODE-237 writings RLS policy migration", () => {
  const source = readFileSync(migrationPath, "utf8")
  const [activeSql] = source.split("-- Rollback reference (manual):")

  it("drops and recreates both author write policies", () => {
    expect(source).toContain("drop policy if exists writings_insert_author on public.writings;")
    expect(source).toContain("create policy writings_insert_author")
    expect(source).toContain("drop policy if exists writings_update_author on public.writings;")
    expect(source).toContain("create policy writings_update_author")
  })

  it("matches correspondence rows through the candidate parent row", () => {
    expect(activeSql).toContain("c.root_writing_id = id")
    expect(activeSql).toContain("where parent.id = parent_id")
    expect(activeSql).not.toContain("c.root_writing_id = c.id")
    expect(activeSql).not.toContain("parent.id = parent.parent_id")
  })

  it("keeps a manual rollback reference for the replaced policies", () => {
    expect(source).toContain("-- Rollback reference (manual):")
    expect(source).toContain("-- create policy writings_insert_author")
    expect(source).toContain("-- create policy writings_update_author")
  })
})
