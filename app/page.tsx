import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="relative isolate overflow-hidden">
        <div className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(circle_at_top,_hsla(var(--cursor),0.12),_transparent_58%)]" />
        <div className="absolute inset-x-0 top-0 -z-10 h-px bg-border/80" />

        <section className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-16 sm:px-10 lg:px-16">
          <div className="grid w-full gap-14 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,420px)] lg:items-end">
            <div className="max-w-2xl space-y-8">
              <div className="space-y-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--ink-4))]">
                  Odessay
                </p>
                <div className="space-y-4">
                  <h1 className="max-w-3xl font-lora text-[46px] font-medium leading-[1.02] tracking-[-0.03em] text-foreground sm:text-[60px]">
                    Write with calm. Publish with intent.
                  </h1>
                  <p className="max-w-xl text-[17px] leading-8 text-[hsl(var(--ink-3))] sm:text-[18px]">
                    A focused writing space for letters, essays, and long-form thinking. Start a
                    new account or return to your desk.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/signup"
                  className="inline-flex h-11 items-center justify-center rounded-[10px] bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[hsl(var(--ink-2))]"
                >
                  Sign up
                </Link>
                <Link
                  href="/login"
                  className="inline-flex h-11 items-center justify-center rounded-[10px] border border-border bg-card px-5 text-sm font-medium text-[hsl(var(--ink-2))] transition-colors hover:bg-[hsl(var(--muted))]"
                >
                  Sign in
                </Link>
              </div>
            </div>

            <aside className="rounded-[18px] border-[0.5px] border-border/80 bg-card/90 p-6 shadow-[0_18px_50px_rgba(36,30,24,0.08)] backdrop-blur">
              <div className="space-y-6">
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[hsl(var(--ink-4))]">
                    For deliberate writing
                  </p>
                  <p className="font-lora text-[28px] leading-[1.15] text-foreground">
                    A quieter home while the full product takes shape.
                  </p>
                </div>

                <div className="space-y-4 text-[15px] leading-7 text-[hsl(var(--ink-3))]">
                  <p>
                    Draft in peace, come back to your work later, and keep the interface out of
                    the way.
                  </p>
                  <p>
                    Authentication is already available. The rest of the public homepage can grow
                    from here without blocking entry to the app.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
