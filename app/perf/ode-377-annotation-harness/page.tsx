import { notFound } from "next/navigation"
import type { JSONContent } from "@tiptap/core"
import { renderWritingBodyHtml } from "@/lib/reading/render-body-html"

const isHarnessEnabled =
  process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

const annotationText = (text: string, annotationType: string): JSONContent => ({
  type: "text",
  text,
  marks: [{ type: "highlight", attrs: { annotationType } }],
})

const annotationRef = (type: string, index: number): JSONContent => ({
  type: "annotationReference",
  attrs: { id: `ode-377-${type}-${index}`, type, index, text: `${type} note` },
})

const inlineFixture = (label: string, index: number): JSONContent[] => [
  { type: "text", text: `${label}: ` },
  annotationText("AI passage", "ai"),
  annotationRef("ai", index),
  { type: "text", text: " · " },
  annotationText("Personal passage", "personal"),
  annotationRef("personal", index),
  { type: "text", text: " · " },
  annotationText("Saved highlight", "highlight"),
  annotationRef("highlight", index),
  { type: "text", text: " · " },
  annotationText("Footnote passage", "footnote"),
  annotationRef("footnote", index),
]

const FIXTURE: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: inlineFixture("Heading", 1) },
    { type: "paragraph", content: inlineFixture("Paragraph", 2) },
    {
      type: "blockquote",
      content: [{ type: "paragraph", content: inlineFixture("Blockquote", 3) }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: inlineFixture("List", 4) }],
        },
      ],
    },
  ],
}

const SURFACE_LABELS = {
  write: "/write/[id] — rich editor",
  preview: "/preview/[token]",
  shared: "/shared/[id]",
  public: "/{username}/{slug}",
} as const

type Surface = keyof typeof SURFACE_LABELS

export default async function Ode377AnnotationHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string }>
}) {
  if (!isHarnessEnabled) notFound()

  const requestedSurface = (await searchParams).surface ?? "write"
  const surface: Surface = requestedSurface in SURFACE_LABELS ? (requestedSurface as Surface) : "write"
  const { bodyHtml } = renderWritingBodyHtml(FIXTURE, "")
  const isWrite = surface === "write"

  return (
    <main className="min-h-screen bg-bg px-8 py-8 text-ink" data-testid="ode-377-annotation-harness">
      <div className="mx-auto mb-8 max-w-[980px] border-b-[0.5px] border-border pb-4">
        <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">
          ODE-377 annotation color fidelity
        </p>
        <p className="mt-2 font-sans text-[14px] text-ink-2" data-testid="surface-label">
          {SURFACE_LABELS[surface]}
        </p>
      </div>

      <article className="mx-auto max-w-[980px] rounded-[10px] border-[0.5px] border-border bg-sb px-12 py-10 shadow-float">
        <div
          className={isWrite ? "odessay-editor-content odessay-rich-content" : "prose-odessay odessay-rich-content"}
          data-testid="annotation-fixture"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </article>
    </main>
  )
}
