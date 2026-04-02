import type { Metadata } from "next"
import { WritingContentFrame } from "@/components/reading/writing-content-frame"
import { getPreviewWritingFromTestLink } from "@/lib/sharing/test-link-access"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Odessay preview",
  robots: {
    index: false,
    follow: false,
  },
}

type PreviewPageProps = {
  params: Promise<{ token: string }>
}

const formatDate = (value: string) => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "Unknown date"
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

const ErrorState = ({ title, description }: { title: string; description: string }) => (
  <section
    id="preview-reading"
    data-page="preview-reading"
    className="mx-auto flex min-h-screen w-full max-w-[680px] items-center px-6 py-12"
  >
    <div className="w-full rounded-xl border-[0.5px] border-border bg-sb p-6 shadow-float">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Closed UX preview</p>
      <h1 className="mt-3 font-lora text-[28px] leading-tight text-ink">{title}</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-3">{description}</p>
    </div>
  </section>
)

export default async function PreviewPage({ params }: PreviewPageProps) {
  const { token } = await params
  const result = await getPreviewWritingFromTestLink(token)

  if (result.state === "not-found") {
    return (
      <ErrorState
        title="Preview link not found"
        description="This link is invalid or has never been generated. Ask the author for a fresh test link."
      />
    )
  }

  if (result.state === "revoked") {
    return (
      <ErrorState
        title="Preview link revoked"
        description="The author revoked this evaluation link. Request a new link if you still need access."
      />
    )
  }

  if (result.state === "unavailable") {
    return (
      <ErrorState
        title="Preview temporarily unavailable"
        description="Odessay could not load this writing right now. Retry in a moment."
      />
    )
  }

  return (
    <section id="preview-reading" data-page="preview-reading" className="min-h-screen bg-bg">
      <header className="PreviewTopbar sticky top-0 z-10 h-[46px] border-b-[0.5px] border-border bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex h-full w-full max-w-[860px] items-center justify-between px-6">
          <p className="text-[12px] font-medium text-ink-2">Read-only UX preview</p>
          <p className="text-[11px] text-ink-4">Closed sharing link</p>
        </div>
      </header>

      <main className="PreviewContent w-full">
        <article className="w-full">
          <WritingContentFrame
            title={result.writing.title}
            bodyHtml={result.writing.bodyHtml}
            bodyId="preview-body"
            bodyTestId="preview-body"
            showTitle={false}
          >
            <div className="border-b-[0.5px] border-border pb-5">
              <p className="text-[12px] text-ink-4">By {result.writing.author.displayName ?? result.writing.author.username ?? "Odessay author"}</p>
              <p className="mt-3 text-[12px] text-ink-4">Updated {formatDate(result.writing.updatedAt)}</p>
            </div>
          </WritingContentFrame>
        </article>
      </main>
    </section>
  )
}
