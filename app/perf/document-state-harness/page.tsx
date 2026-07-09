import {
  DocumentStateBadge,
  DocumentStateTooltipProvider,
} from "@/components/ui/document-state-badge";
import { WritingStatusBadge } from "@/components/ui/writing-status-badge";
import type { DocumentState } from "@/lib/writings/document-state";

const states: DocumentState[] = [
  "cloud-only",
  "local-only",
  "synced",
  "pending",
];

export default function DocumentStateHarnessPage() {
  return (
    <DocumentStateTooltipProvider>
      <main className="min-h-screen bg-bg px-10 py-10 text-ink">
        <section
          data-testid="document-state-harness"
          className="mx-auto max-w-[760px] rounded-[12px] border-[0.5px] border-border bg-sb p-6 shadow-float"
        >
          <div className="mb-5 flex items-center justify-between border-b-[0.5px] border-border pb-4">
            <h1 className="font-lora text-[22px] font-medium text-ink">
              Document state badges
            </h1>
            <WritingStatusBadge status="draft" variant="compact" />
          </div>

          <div className="grid gap-3">
            {states.map((state) => (
              <div
                key={state}
                className="grid grid-cols-[140px_1fr_1fr] items-center gap-4 rounded-[8px] bg-bg px-4 py-3"
              >
                <span className="text-[12px] font-medium uppercase tracking-[0.07em] text-ink-4">
                  {state}
                </span>
                <WritingStatusBadge
                  status="draft"
                  variant="compact"
                  className="justify-self-start"
                />
                <DocumentStateBadge
                  state={state}
                  variant="compact"
                  className="justify-self-start"
                />
              </div>
            ))}
          </div>
        </section>
      </main>
    </DocumentStateTooltipProvider>
  );
}
