import Link from "next/link"

const manifestoExcerpt =
  "Odessay is a sanctuary for slow writing. A place where each word can keep its weight, and the reply matters as much as the sending."

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-2">
      <div className="flex min-h-screen flex-col bg-bg">
        <div className="px-8 py-7">
          <Link className="font-lora text-[17px] text-ink transition-colors hover:text-ink-2" href="/">
            Odessay
          </Link>
        </div>

        <main className="flex flex-1 items-center justify-center px-8 pb-16 pt-8">
          <div className="w-full max-w-[28rem]">{children}</div>
        </main>
      </div>

      <aside className="hidden border-l-[0.5px] border-border bg-muted lg:flex lg:items-center lg:justify-center lg:px-16">
        <div className="max-w-[28rem] space-y-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">
            Manifesto fragment
          </p>
          <blockquote className="font-lora text-[2rem] italic leading-[1.55] text-ink-3">
            {manifestoExcerpt}
          </blockquote>
        </div>
      </aside>
    </div>
  )
}
