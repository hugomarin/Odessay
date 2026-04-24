import { notFound } from "next/navigation"
import Link from "next/link"

const isHarnessEnabled =
  process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

const HARNESS_COLLECTIONS = [
  { id: "col-letters", name: "Letters", count: 12 },
  { id: "col-essays", name: "Essays", count: 7 },
  { id: "col-notes", name: "Field notes", count: 4 },
  { id: "col-fiction", name: "Fiction", count: 9 },
]

const HARNESS_WRITINGS = [
  {
    id: "w-1",
    title: "On attention and presence",
    excerpt:
      "Reading both of you, I keep coming back to something that neither named directly but that I feel underneath both texts.",
    wordCount: 1240,
    updatedAt: "2026-04-20T14:00:00.000Z",
    status: "Draft",
    otherCollections: ["Essays"],
  },
  {
    id: "w-2",
    title: "The slow arrival of spring",
    excerpt:
      "There is a word in Japanese — mono no aware — that describes the bittersweet awareness of impermanence.",
    wordCount: 870,
    updatedAt: "2026-04-18T10:30:00.000Z",
    status: "Done",
    otherCollections: [],
  },
  {
    id: "w-3",
    title: "What silence knows",
    excerpt:
      "Silence is not the absence of language. It is a different kind of speech, one that requires more skill to hear.",
    wordCount: 2010,
    updatedAt: "2026-04-15T08:00:00.000Z",
    status: "Draft",
    otherCollections: ["Field notes"],
  },
]

export default function CollectionsPerfHarnessPage() {
  if (!isHarnessEnabled) {
    notFound()
  }

  return (
    <section data-page="collections" data-testid="collections-harness" className="flex min-h-screen flex-col bg-bg">
      <header className="border-b-[0.5px] border-border">
        <div className="flex h-[46px] items-center px-6 md:px-9">
          <p className="font-lora text-[15px] text-ink-2">Collections</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6 md:px-9">
        <div className="mx-auto grid w-full max-w-[1040px] grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          {/* Uncategorized card — always first */}
          <Link
            href="/perf/collections-harness/uncategorized"
            data-testid="collection-card-uncategorized"
            className="flex min-h-[96px] flex-col justify-between rounded-[10px] border-[0.5px] border-dashed border-border bg-transparent px-[14px] py-3 transition-colors hover:bg-muted/40"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-lora text-[18px] font-medium text-ink">Uncategorized</h2>
              <span className="rounded-full border-[0.5px] border-border px-2 py-0.5 text-[11px] text-ink-4">3</span>
            </div>
          </Link>

          {/* Collection cards */}
          {HARNESS_COLLECTIONS.map((collection) => (
            <Link
              key={collection.id}
              href={`/perf/collections-harness/${collection.id}`}
              data-testid={`collection-card-${collection.id}`}
              className="flex min-h-[96px] flex-col justify-between rounded-[10px] border-[0.5px] border-border bg-sb px-[14px] py-3 transition-colors hover:bg-muted/30"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-lora text-[18px] font-medium text-ink">{collection.name}</h2>
                <span className="rounded-full border-[0.5px] border-border px-2 py-0.5 text-[11px] text-ink-4">
                  {collection.count}
                </span>
              </div>
            </Link>
          ))}

          {/* New collection dashed card */}
          <button
            type="button"
            data-testid="new-collection-card"
            className="flex min-h-[96px] flex-col justify-between rounded-[10px] border-[0.5px] border-dashed border-border bg-transparent px-[14px] py-3 text-left transition-colors hover:bg-muted/40"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-sans text-[14px] font-medium text-ink-2">New collection</h2>
            </div>
          </button>
        </div>
      </div>

      {/* Detail panel rendered inline for the harness — simulates /collections/[id] content */}
      <div data-testid="collections-detail-harness" className="border-t-[0.5px] border-border">
        <div className="flex min-h-[88px] items-end justify-between gap-4 px-6 py-5 md:px-9">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] text-ink-4">
              <span className="transition-colors hover:text-ink-2">Collections</span>
              <span>{">"}</span>
              <span className="truncate">Letters</span>
            </div>
            <h1 className="pt-2 font-lora text-[28px] font-medium text-ink">Letters</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="rename-collection-btn"
              className="inline-flex h-9 items-center gap-2 rounded-[8px] border-[0.5px] border-border px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted"
            >
              Rename
            </button>
            <button
              type="button"
              data-testid="delete-collection-btn"
              className="inline-flex h-9 items-center gap-2 rounded-[8px] border-[0.5px] border-border px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="px-6 pb-10 pt-4 md:px-9">
          <div className="mx-auto w-full max-w-[980px]">
            <div className="border-t-[0.5px] border-border" data-testid="collection-detail-list">
              {HARNESS_WRITINGS.map((writing) => (
                <div
                  key={writing.id}
                  data-testid={`writing-row-${writing.id}`}
                  className="group grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 border-b-[0.5px] border-border px-1 py-[18px] transition-colors duration-150 ease-out hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <h2 className="font-lora text-[15px] font-medium leading-[1.3] text-ink transition-colors duration-150 ease-out group-hover:text-cursor">
                      {writing.title}
                    </h2>
                    <p className="truncate pt-1 font-sans text-[12px] italic text-ink-3">{writing.excerpt}</p>
                    {writing.otherCollections.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {writing.otherCollections.map((col) => (
                          <span
                            key={col}
                            className="rounded-[13px] border-[0.5px] border-border bg-muted px-2 py-0.5 text-[11px] text-ink-3"
                          >
                            {col}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="pt-0.5 text-right font-sans text-[12px] text-ink-4">
                    <p>{`${writing.wordCount.toLocaleString()} words · Apr 20 · ${writing.status}`}</p>
                  </div>

                  <div className="flex items-start justify-end">
                    <div className="flex items-center gap-2 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100">
                      <button
                        type="button"
                        data-testid={`remove-btn-${writing.id}`}
                        className="inline-flex h-7 items-center rounded-[6px] border-[0.5px] border-border px-2 text-[12px] text-ink-2 transition-colors hover:bg-muted"
                      >
                        Remove from collection
                      </button>
                      <button
                        type="button"
                        data-testid={`open-btn-${writing.id}`}
                        className="inline-flex h-7 items-center rounded-[6px] border-[0.5px] border-border px-2 text-[12px] text-ink-2 transition-colors hover:bg-muted"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
