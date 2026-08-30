import { SharedWithMeList } from "@/components/desk/shared-with-me-list"

export default function DeskSharedHarnessPage() {
  return (
    <section className="min-h-screen bg-bg">
      <div className="flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-5 sm:px-9">
        <div className="flex min-w-0 items-center gap-4">
          <p className="shrink-0 font-lora text-[15px] text-ink-2">Desk</p>
          <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              aria-pressed="false"
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-ink-3 transition-colors"
            >
              My artifacts
            </button>
            <button
              type="button"
              aria-pressed="true"
              data-testid="desk-view-tab-shared"
              className="rounded-md bg-bg px-3 py-1.5 text-[13px] font-medium text-ink shadow-sm transition-colors"
            >
              Shared with me
            </button>
          </div>
        </div>
        <span className="text-[13px] font-medium text-ink-3">Sign out</span>
      </div>

      <SharedWithMeList
        items={[
          {
            id: "fixture-shared-writing-1",
            title: "Shared fixture letter",
            slug: "shared-fixture-letter",
            excerpt: "A fixture artifact that appears in the shared tab during Playwright runs.",
            updatedAt: "2026-03-31T15:00:00.000Z",
            author: {
              username: "fixture-author",
              displayName: "Fixture Author",
            },
          },
        ]}
      />
    </section>
  )
}
