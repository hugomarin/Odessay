import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("archived artifact select RLS", () => {
  const sql = readFileSync(
    "supabase/migrations/20260729020000_allow_owner_select_archived_writings.sql",
    "utf8",
  )

  it("exposes archived rows only to their owner", () => {
    expect(sql).toContain("for select")
    expect(sql).toContain("auth.uid() = author_id and deleted_at is not null")
    expect(sql).not.toContain("service_role")
  })

  it("documents rollback", () => expect(sql).toContain("-- Rollback:"))
})
