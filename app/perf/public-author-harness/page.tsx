import { notFound } from "next/navigation"
import { AuthorHeader } from "@/components/public/author-header"
import { PublicWritingList } from "@/components/public/public-writing-list"

const isHarnessEnabled =
  process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

export default function PublicAuthorPerfHarnessPage() {
  if (!isHarnessEnabled) {
    notFound()
  }

  return (
    <section className="min-h-screen bg-bg">
      <header className="border-b-[0.5px] border-border">
        <div className="mx-auto flex h-[46px] w-full max-w-[720px] items-center justify-between px-5 sm:px-6">
          <span className="font-lora text-[17px] text-ink">Odessay</span>
          <span className="text-[13px] font-medium text-ink-3">Desk</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] px-5 pb-16 pt-10 sm:px-6 sm:pt-12">
        <div className="flex flex-col gap-12">
          <AuthorHeader
            profile={{
              displayName: "Laura Castillo",
              username: "laura",
              bio: "Escribo sobre atención, distancia y formas de acompañarnos en la página.",
            }}
          />

          <PublicWritingList
            username="laura"
            isOwner={false}
            writings={[
              {
                id: "public-author-harness-1",
                title: "The problem with being understood",
                bodyText:
                  "I keep returning to the idea that sometimes we want to be accompanied more than understood.",
                updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
                visibility: "public",
                status: "finished",
                slug: "the-problem-with-being-understood",
                version: 1,
              },
              {
                id: "public-author-harness-2",
                title: "Receiving",
                bodyText:
                  "What happens when a letter lands and the reader is asked to choose whether to open it?",
                updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
                visibility: "public",
                status: "finished",
                slug: "receiving",
                version: 1,
              },
            ]}
            collections={[
              {
                id: "public-author-harness-collection",
                name: "Letters",
                writingIds: [
                  "public-author-harness-1",
                  "public-author-harness-2",
                ],
              },
            ]}
          />
        </div>
      </main>
    </section>
  )
}
