"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { PERF_WRITING_FIXTURE } from "../../writing-route-fixture"

type Props = {
  id: string
}

export function WriteCanonicalHarness({ id }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (id === PERF_WRITING_FIXTURE.id && pathname !== `/perf/write-canonical/${PERF_WRITING_FIXTURE.slug}`) {
      router.replace(`/perf/write-canonical/${PERF_WRITING_FIXTURE.slug}`)
    }
  }, [id, pathname, router])

  return (
    <main data-testid="write-canonical-harness" className="min-h-screen bg-bg px-6 py-10 text-ink">
      <h1 className="font-lora text-3xl">{PERF_WRITING_FIXTURE.title}</h1>
      <p className="mt-3 text-[15px] text-ink-3">{PERF_WRITING_FIXTURE.body}</p>
      <p className="mt-6 text-[13px] text-ink-4">Canonical URL: /perf/write-canonical/{PERF_WRITING_FIXTURE.slug}</p>
    </main>
  )
}
