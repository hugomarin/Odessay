"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { SignOutButton } from "@/components/auth/sign-out-button"
import { DeskActivityTable } from "@/components/desk/desk-activity-table"
import { DeskFilterBar } from "@/components/desk/desk-filter-bar"
import { DeskHero } from "@/components/desk/desk-hero"
import { getLocalDBScope, localDB, subscribeToLocalDBScopeChanges } from "@/lib/local-db"
import {
  buildDeskActivitySummary,
  type DeskActivityFilter,
  type DeskActivitySummary,
} from "@/lib/queries/desk-activity"

const EMPTY_SUMMARY: DeskActivitySummary = {
  heroDrafts: [],
  groups: [],
  counts: {
    all: 0,
    correspondence: 0,
    "with-responses": 0,
    received: 0,
  },
  total: 0,
}

export default function DeskPage() {
  const [activeFilter, setActiveFilter] = useState<DeskActivityFilter>("all")
  const [summary, setSummary] = useState<DeskActivitySummary>(EMPTY_SUMMARY)
  const [isLoading, setIsLoading] = useState(true)

  const loadDeskActivity = useCallback(async (filter: DeskActivityFilter) => {
    const localWritings = await localDB.writings.getAll()
    const localScope = getLocalDBScope()

    setSummary(
      buildDeskActivitySummary(localWritings, {
        filter,
        userId: localScope === "anonymous" ? null : localScope,
      }),
    )
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      await loadDeskActivity(activeFilter)
      if (!cancelled) {
        setIsLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [activeFilter, loadDeskActivity])

  useEffect(() => {
    return subscribeToLocalDBScopeChanges(() => {
      void loadDeskActivity(activeFilter)
    })
  }, [activeFilter, loadDeskActivity])

  useEffect(() => {
    const handleRefresh = () => {
      void loadDeskActivity(activeFilter)
    }

    window.addEventListener("focus", handleRefresh)
    window.addEventListener("online", handleRefresh)

    return () => {
      window.removeEventListener("focus", handleRefresh)
      window.removeEventListener("online", handleRefresh)
    }
  }, [activeFilter, loadDeskActivity])

  const counts = useMemo(() => summary.counts, [summary.counts])

  return (
    <section id="desk" data-page="desk" className="Desk flex min-h-screen flex-col bg-bg">
      <div
        id="desk-topbar"
        data-section="desk-topbar"
        data-testid="desk-topbar"
        className="DeskTopbar flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-9"
      >
        <p className="font-lora text-[15px] text-ink-2">Desk</p>
        <SignOutButton />
      </div>

      <DeskHero drafts={summary.heroDrafts} />

      <DeskFilterBar activeFilter={activeFilter} counts={counts} onFilterChange={setActiveFilter} />

      <DeskActivityTable groups={summary.groups} isLoading={isLoading} />
    </section>
  )
}
