import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("archived writing hard-delete RLS", () => {
  const sql = readFileSync("supabase/migrations/20260729010000_allow_owner_hard_delete_archived_writings.sql", "utf8")
  it("permits only the owner and only after soft delete", () => {
    expect(sql).toContain("auth.uid() = author_id and deleted_at is not null")
    expect(sql).not.toContain("service_role")
  })
  it("documents rollback", () => expect(sql).toContain("-- Rollback:"))
})
