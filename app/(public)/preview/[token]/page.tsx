import type { Metadata } from "next"
import { AddToMyWritingsButton } from "@/components/reading/add-to-my-writings-button"
import { PreviewBodyWithMargins } from "@/components/reading/preview-body-with-margins"
import { createClient } from "@/lib/supabase/server"
import { getPreviewWritingFromTestLink } from "@/lib/sharing/test-link-access"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Artifact Studio preview",
  robots: {
    index: false,
    follow: false,
  },
}

type PreviewPageProps = {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ import?: string | string[] | undefined }>
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

export default async function PreviewPage({ params, searchParams }: PreviewPageProps) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
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
        description="Artifact Studio could not load this artifact right now. Retry in a moment."
      />
    )
  }

  const authorName = result.writing.author.displayName ?? result.writing.author.username ?? "Artifact Studio author"
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const autoImport = resolvedSearchParams?.import === "1"
  const nextPath = `/preview/${encodeURIComponent(token)}?import=1`
  const loginHref = user ? null : `/login?next=${encodeURIComponent(nextPath)}`

  return (
    <section id="preview-reading" data-page="preview-reading" className="min-h-screen bg-bg">
      <header className="PreviewTopbar sticky top-0 z-10 h-[46px] border-b-[0.5px] border-border bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex h-full w-full max-w-[860px] items-center justify-between px-6">
          <p className="text-[12px] font-medium text-ink-2">Read-only UX preview</p>
          <div className="flex items-center gap-4">
            <p className="text-[11px] text-ink-4">Closed sharing link</p>
            <AddToMyWritingsButton
              source="preview"
              token={token}
              loginHref={loginHref}
              autoStart={Boolean(user) && autoImport}
            />
          </div>
        </div>
      </header>

      <main className="PreviewContent w-full">
        <article className="w-full">
          <div className="mx-auto max-w-[860px] px-6 py-8">
            <PreviewBodyWithMargins
              token={token}
              title={result.writing.title}
              bodyHtml={result.writing.bodyHtml}
              updatedAt={result.writing.updatedAt}
              authorName={authorName}
            />
          </div>
        </article>
      </main>
    </section>
  )
}

export function generateStaticParams() {
  return [{ token: "placeholder" }]
}
