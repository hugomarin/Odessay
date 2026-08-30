import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("archived artifact restore RLS", () => {
  const sql = readFileSync(
    "supabase/migrations/20260729030000_allow_owner_restore_archived_writings.sql",
    "utf8",
  )

  it("permits only an owner transition from archived to active", () => {
    expect(sql).toContain("for update")
    expect(sql).toContain("using (auth.uid() = author_id and deleted_at is not null)")
    expect(sql).toContain("with check (auth.uid() = author_id and deleted_at is null)")
    expect(sql).not.toContain("service_role")
  })

  it("documents rollback", () => expect(sql).toContain("-- Rollback:"))
})
