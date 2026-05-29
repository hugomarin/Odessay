import { notFound, permanentRedirect } from "next/navigation"
import { PERF_WRITING_FIXTURE } from "../../writing-route-fixture"

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function SharedCanonicalHarnessPage({ params }: PageProps) {
  const { id } = await params

  if (id === PERF_WRITING_FIXTURE.id) {
    permanentRedirect(`/perf/shared-canonical/${PERF_WRITING_FIXTURE.slug}`)
  }

  if (id !== PERF_WRITING_FIXTURE.slug) {
    notFound()
  }

  return (
    <main data-testid="shared-canonical-harness" className="min-h-screen bg-bg px-6 py-10 text-ink">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-4">Shared reading</p>
      <h1 className="mt-3 font-lora text-3xl">{PERF_WRITING_FIXTURE.title}</h1>
      <p className="mt-2 text-[14px] text-ink-3">
        {PERF_WRITING_FIXTURE.authorDisplayName} @{PERF_WRITING_FIXTURE.authorUsername}
      </p>
      <p className="mt-6 text-[13px] text-ink-4">
        Canonical URL: /perf/shared-canonical/{PERF_WRITING_FIXTURE.slug}
      </p>
    </main>
  )
}

export function generateStaticParams() {
  return [{ id: "placeholder" }]
}
