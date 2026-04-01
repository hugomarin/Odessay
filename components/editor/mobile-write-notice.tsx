import Link from "next/link"
import { FileText } from "lucide-react"

export function MobileWriteNotice() {
  return (
    <section
      id="write-mobile-gate"
      data-page="write-mobile-gate"
      data-testid="write-mobile-gate"
      className="flex min-h-[100dvh] items-center justify-center bg-bg px-6 py-10"
    >
      <div className="w-full max-w-[360px] rounded-[12px] border-[0.5px] border-border bg-sb px-6 py-7 text-center shadow-float">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted text-ink-2">
          <FileText strokeWidth={1.5} className="h-[18px] w-[18px]" />
        </div>

        <p className="mt-4 font-lora text-[24px] font-medium leading-[1.2] tracking-[-0.01em] text-ink">
          Writing is desktop only
        </p>

        <p className="mt-3 text-[14px] leading-relaxed text-ink-3">
          Odessay keeps the writing space on larger screens. You can keep reading on mobile, but composing a new
          writing is meant for desktop.
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/desk"
            className="inline-flex h-9 items-center justify-center rounded-[8px] bg-ink px-4 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
          >
            Go to desk
          </Link>
        </div>
      </div>
    </section>
  )
}
