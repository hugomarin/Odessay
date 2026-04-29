"use client"

import Link from "next/link";
import { Clock3 } from "lucide-react";
import { useRecentWritings } from "@/hooks/useRecentWritings";
import { cn } from "@/lib/utils";

type SidebarRecentWritingsProps = {
  collapsed: boolean;
};

export function SidebarRecentWritings({ collapsed }: SidebarRecentWritingsProps) {
  const recentWritings = useRecentWritings(8);

  if (collapsed || recentWritings.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 px-2">
      <div className="mb-2 flex items-center gap-2 px-2">
        <Clock3 className="h-[13px] w-[13px] text-ink-4" strokeWidth={1.5} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">Recent</p>
      </div>

      <div className="space-y-1">
        {recentWritings.map((writing) => (
          <Link
            key={writing.writingId}
            href={`/write/${writing.slug ?? writing.writingId}`}
            className="flex min-w-0 items-center gap-2 rounded-md px-2 py-[8px] text-left transition-colors hover:bg-muted-hover"
          >
            {writing.isOpen ? <span className="w-[6px] shrink-0" aria-hidden="true" /> : (
              <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0 rounded-full bg-border" />
            )}
            <span
              className={cn(
                "min-w-0 truncate font-sans text-[13px] text-ink-2",
                writing.isOpen && "text-ink",
              )}
            >
              {writing.title}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
