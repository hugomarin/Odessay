import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260706131656_inline_writings_select_policy.sql",
)

describe("ODE-355 inline writings SELECT RLS policy migration", () => {
  const source = readFileSync(migrationPath, "utf8")
  const [activeSql] = source.split("-- Rollback reference (manual):")

  it("creates the has_writing_share helper", () => {
    expect(activeSql).toContain("create or replace function public.has_writing_share(target_writing_id uuid)")
    expect(activeSql).toContain("security definer")
    expect(activeSql).toContain("stable")
    expect(activeSql).toContain("set search_path = public")
  })

  it("helper only queries writing_shares, never writings", () => {
    const functionMatch = activeSql.match(/create or replace function public\.has_writing_share[\s\S]*?\$\$;/)
    expect(functionMatch).toBeTruthy()
    const functionBody = functionMatch![0]
    expect(functionBody).toContain("from public.writing_shares")
    expect(functionBody).not.toContain("from public.writings")
    expect(functionBody).not.toContain("public.writings")
  })

  it("drops and recreates the writings_select_accessible policy", () => {
    expect(activeSql).toContain("drop policy if exists writings_select_accessible on public.writings;")
    expect(activeSql).toContain("create policy writings_select_accessible")
  })

  it("uses initplan (select auth.uid()) instead of per-row auth.uid()", () => {
    expect(activeSql).toContain("author_id = (select auth.uid())")
  })

  it("keeps deleted_at filter in the policy", () => {
    expect(activeSql).toContain("deleted_at is null")
  })

  it("orders access branches owner -> public -> shared", () => {
    const policyMatch = activeSql.match(/create policy writings_select_accessible[\s\S]*?\);/)
    expect(policyMatch).toBeTruthy()
    const policyBody = policyMatch![0]

    const ownerIndex = policyBody.indexOf("author_id = (select auth.uid())")
    const publicIndex = policyBody.indexOf("visibility = 'public'")
    const sharedIndex = policyBody.indexOf("visibility = 'shared'")

    expect(ownerIndex).toBeGreaterThan(-1)
    expect(publicIndex).toBeGreaterThan(-1)
    expect(sharedIndex).toBeGreaterThan(-1)
    expect(ownerIndex).toBeLessThan(publicIndex)
    expect(publicIndex).toBeLessThan(sharedIndex)
  })

  it("shared branch calls has_writing_share", () => {
    expect(activeSql).toContain("public.has_writing_share(id)")
  })

  it("keeps a manual rollback reference for the replaced policy", () => {
    expect(source).toContain("-- Rollback reference (manual):")
    expect(source).toContain("-- create policy writings_select_accessible")
    expect(source).toContain("-- using (public.can_read_writing(id, auth.uid()));")
    expect(source).toContain("-- drop function if exists public.has_writing_share(uuid);")
  })
})
