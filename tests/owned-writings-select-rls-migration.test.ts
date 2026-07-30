import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("owner writing select RLS", () => {
  const sql = readFileSync(
    "supabase/migrations/20260729040000_allow_owner_select_owned_writings.sql",
    "utf8",
  )

  it("gives authors a direct select path only to rows they own", () => {
    expect(sql).toContain("for select")
    expect(sql).toContain("using (auth.uid() = author_id)")
    expect(sql).not.toContain("using (true)")
    expect(sql).not.toContain("service_role")
  })

  it("replaces the archived-only companion policy", () => {
    expect(sql).toContain("drop policy if exists writings_select_author_archived")
    expect(sql).toContain("-- Rollback:")
  })
})
