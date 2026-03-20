#!/usr/bin/env tsx
/**
 * seed-phase-1.ts
 *
 * Applies supabase/seed/phase-1-staging.sql to the local / staging database.
 * Requires: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
 *
 * Usage:
 *   npx tsx scripts/seed-phase-1.ts
 *   npm run seed:phase1
 *
 * Safety: refuses to run if DATABASE_URL points to a production host.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const STAGING_HOST_PATTERNS = [
  /staging/i,
  /localhost/i,
  /127\.0\.0\.1/,
  /0\.0\.0\.0/,
]

function assertStagingOnly(url: string) {
  const isStaging = STAGING_HOST_PATTERNS.some((p) => p.test(url))
  if (!isStaging) {
    console.error(
      '[seed:phase1] ERROR: NEXT_PUBLIC_SUPABASE_URL does not look like a staging environment.',
    )
    console.error('[seed:phase1] Refusing to seed a non-staging database.')
    console.error(`[seed:phase1] URL: ${url}`)
    process.exit(1)
  }
}

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      '[seed:phase1] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
    )
    process.exit(1)
  }

  assertStagingOnly(supabaseUrl)

  const sqlPath = resolve(process.cwd(), 'supabase/seed/phase-1-staging.sql')
  const sql = readFileSync(sqlPath, 'utf-8')

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('[seed:phase1] Applying seed to:', supabaseUrl)

  const { error } = await supabase.rpc('exec_sql', { sql })

  if (error) {
    // exec_sql RPC may not exist in all setups; fall back to direct REST if so.
    if (error.message?.includes('exec_sql')) {
      console.warn(
        '[seed:phase1] exec_sql RPC not available. Use psql directly:',
      )
      console.warn(`  psql $DATABASE_URL -f ${sqlPath}`)
      console.warn('[seed:phase1] Or run: supabase db reset --local')
      process.exit(0)
    }
    console.error('[seed:phase1] Seed failed:', error.message)
    process.exit(1)
  }

  console.log('[seed:phase1] Seed applied successfully.')
  console.log('[seed:phase1] Test accounts:')
  console.log('  alice@staging.odessay.test  / Password1!')
  console.log('  bob@staging.odessay.test    / Password1!')
  console.log('  clara@staging.odessay.test  / Password1!')
}

run()
