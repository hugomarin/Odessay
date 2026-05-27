"use client";

import { useEffect, useState, useTransition } from "react";
import { localDB } from "@/lib/local-db";
import type { LocalWriting } from "@/lib/local-db/schema";
import { enqueueWritingUpsert, webSyncService } from "@/lib/sync";

const createDemoWriting = (): LocalWriting => {
  const timestamp = new Date();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `writing-${timestamp.getTime()}`;

  return {
    id,
    title: "Untitled writing",
    body_json: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: `Draft created at ${timestamp.toLocaleTimeString()}.`,
            },
          ],
        },
      ],
    },
    body_text: `Draft created at ${timestamp.toLocaleTimeString()}.`,
    status: "draft",
    visibility: "private",
    version: 1,
    sync_status: "pending",
    lifecycle: "local-only",
    created_at: timestamp.toISOString(),
    updated_at: timestamp.toISOString(),
    local_updated_at: timestamp.getTime(),
  };
};

export function LocalFirstDemo() {
  const [writings, setWritings] = useState<LocalWriting[]>([]);
  const [isPending, startTransition] = useTransition();

  const refresh = async () => {
    const items = await localDB.writings.getAll({ includeDeleted: true });
    setWritings(items);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleCreateDraft = () => {
    startTransition(() => {
      void enqueueWritingUpsert(createDemoWriting()).then(() => {
        void webSyncService.scheduleFlush()
        return refresh()
      });
    });
  };

  return (
    <section
      id="local-first-demo"
      data-page="local-first-demo"
      className="rounded-[10px] border-[0.5px] border-border bg-card p-6 shadow-sm"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1">
          <h2 className="font-lora text-[22px] font-medium leading-[1.2] text-foreground">
            Local-first storage
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-[hsl(var(--ink-3))]">
            Este botón crea un writing local en IndexedDB y lo encola para sync remoto sin bloquear
            la UI.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCreateDraft}
            disabled={isPending}
            className="inline-flex h-9 items-center rounded-[8px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-[hsl(var(--ink-2))] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Creating..." : "Create local draft"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex h-9 items-center rounded-[8px] border-[0.5px] border-border px-4 text-sm font-medium text-[hsl(var(--ink-2))] transition-colors hover:bg-[hsl(var(--muted))]"
          >
            Refresh
          </button>
        </div>

        <div className="space-y-3 border-t-[0.5px] border-border pt-4">
          <p className="text-xs uppercase tracking-[0.07em] text-[hsl(var(--ink-4))]">
            IndexedDB writings
          </p>
          <ul className="space-y-2">
            {writings.map((writing) => (
              <li
                key={writing.id}
                className="rounded-[8px] border-[0.5px] border-border bg-background px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-lora text-[15px] text-foreground">
                    {writing.title ?? "Untitled writing"}
                  </span>
                  <span className="text-xs text-[hsl(var(--ink-4))]">{writing.sync_status}</span>
                </div>
                <p className="mt-2 text-sm text-[hsl(var(--ink-3))]">{writing.body_text}</p>
              </li>
            ))}
          </ul>

          {writings.length === 0 ? (
            <p className="text-sm text-[hsl(var(--ink-4))]">No local writings yet.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
