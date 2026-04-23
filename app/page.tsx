import Link from "next/link";
import { LocalFirstDemo } from "@/components/local-first/local-first-demo";
import { Sidebar } from "@/components/navigation/sidebar";

export default function Home() {
  return (
    <Sidebar
      user={{
        displayName: "Odessay Preview",
        email: "preview@odessay.local",
        username: "preview",
      }}
    >
      <main className="min-h-screen bg-background px-6 py-16 text-foreground">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
          <header className="space-y-4">
            <p className="text-xs uppercase tracking-[0.07em] text-[hsl(var(--ink-4))]">
              ODE-22 Preview
            </p>
            <div className="space-y-3">
              <h1 className="font-lora text-[36px] font-medium leading-[1.18] text-foreground">
                Global sidebar shell in home
              </h1>
              <p className="max-w-3xl text-[15px] leading-7 text-[hsl(var(--ink-3))]">
                This page now renders the authenticated sidebar shell so you can validate collapsed
                and expanded navigation states without login.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/login"
                className="inline-flex h-9 items-center rounded-[8px] border-[0.5px] border-border px-4 text-sm font-medium text-[hsl(var(--ink-2))] transition-colors hover:bg-[hsl(var(--muted))]"
              >
                Login
              </Link>
              <Link
                href="/signup"
                className="inline-flex h-9 items-center rounded-[8px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-[hsl(var(--ink-2))]"
              >
                Create account
              </Link>
              <Link
                href="/desk"
                className="inline-flex h-9 items-center rounded-[8px] border-[0.5px] border-border px-4 text-sm font-medium text-[hsl(var(--ink-2))] transition-colors hover:bg-[hsl(var(--muted))]"
              >
                Open desk
              </Link>
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
                Once authenticated, the same queue drains remotely through `/api/writings/[id]`.
              </p>
            </article>
          </section>

          <LocalFirstDemo />
        </div>
      </main>
    </Sidebar>
  );
}
