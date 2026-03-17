import { LocalFirstDemo } from "@/components/local-first/local-first-demo";

export default function Home() {
  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
        <header className="space-y-4">
          <p className="text-xs uppercase tracking-[0.07em] text-[hsl(var(--ink-4))]">
            ODE-16
          </p>
          <div className="space-y-3">
            <h1 className="font-lora text-[36px] font-medium leading-[1.18] text-foreground">
              Local-first foundation for Odessay
            </h1>
            <p className="max-w-3xl text-[15px] leading-7 text-[hsl(var(--ink-3))]">
              IndexedDB persists writings immediately. A background worker drains the sync queue
              and retries remote writes with exponential backoff when the network or Supabase is
              unavailable.
            </p>
          </div>
        </header>

        <section className="grid gap-4 rounded-[10px] border-[0.5px] border-border bg-card p-6 shadow-sm md:grid-cols-3">
          <article className="space-y-2">
            <p className="text-xs uppercase tracking-[0.07em] text-[hsl(var(--ink-4))]">
              1. Persist local
            </p>
            <p className="text-sm leading-6 text-[hsl(var(--ink-3))]">
              `localDB` abstracts IndexedDB and keeps browser storage details outside the app.
            </p>
          </article>
          <article className="space-y-2">
            <p className="text-xs uppercase tracking-[0.07em] text-[hsl(var(--ink-4))]">
              2. Queue mutations
            </p>
            <p className="text-sm leading-6 text-[hsl(var(--ink-3))]">
              Every local write becomes a durable sync mutation with retries and error context.
            </p>
          </article>
          <article className="space-y-2">
            <p className="text-xs uppercase tracking-[0.07em] text-[hsl(var(--ink-4))]">
              3. Sync in background
            </p>
            <p className="text-sm leading-6 text-[hsl(var(--ink-3))]">
              The worker wakes up after debounce and when the browser returns online.
            </p>
          </article>
        </section>

        <LocalFirstDemo />
      </div>
    </main>
  );
}
