import Link from "next/link"
import { FileText } from "lucide-react"

type MobileWriteNoticeProps = {
  showDeskLink?: boolean
}

export function MobileWriteNotice({ showDeskLink = true }: MobileWriteNoticeProps) {
  return (
    <section
      id="write-mobile-gate"
      data-page="write-mobile-gate"
      data-testid="write-mobile-gate"
      className="flex min-h-[100dvh] items-center justify-center bg-bg px-6 py-10"
    >
      <div className="w-full max-w-[380px] text-center">
        <Link href="/" className="mx-auto inline-flex flex-col items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border-[0.5px] border-border bg-sb text-ink-2 shadow-float">
            <FileText strokeWidth={1.5} className="h-[18px] w-[18px]" />
          </div>
          <span className="font-lora text-[18px] font-medium tracking-[-0.01em] text-ink">Artifact Studio</span>
        </Link>

        <p className="mt-8 font-lora text-[24px] italic leading-[1.3] tracking-[-0.01em] text-ink-3">
          Writing in Artifact Studio is built for a large screen. Open Artifact Studio on your computer to write.
        </p>

        {showDeskLink ? (
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/desk"
              className="inline-flex h-9 items-center justify-center rounded-[8px] bg-ink px-4 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
            >
              Go to desk
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  )
}
