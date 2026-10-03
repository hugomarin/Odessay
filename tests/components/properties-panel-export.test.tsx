/**
 * EXP-05 — Export success is reported only if an artifact was actually
 * written, and the report names the document that started the export.
 *
 * `PropertiesPanel.handleExport` is the real, unmodified production code
 * under test here: it owns the `if (exported !== true) return` guard that
 * decides whether to show a success toast after `onExportPdf` / `onExportDocx`
 * resolve, and it owns the source-title capture that keeps the report
 * attributed to A while B is selected (ODE-652). Those two props are the only
 * fakes — this proof is about the panel's *reaction* to what they report, not
 * about `saveDesktopBinaryExport`/`tauriWriteBinaryFile` themselves (covered
 * separately, with real fs, in
 * tests/lib/services/desktop/export-delivery.test.ts). Together the files
 * chain-prove the full path: dialog/fs -> service -> UI feedback.
 *
 * See workflow/quality/capability-integration-map.md (EXP-05).
 */
/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PropertiesPanel } from "@/components/editor/panels/properties-panel"
import type { TextMetrics } from "@/lib/editor/text-metrics"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/lib/services/sharing-service-factory", () => ({
  createSharingService: () => ({
    getPreviewLink: vi.fn().mockResolvedValue({
      data: { active: false, token: null, link: null, createdAt: null },
      error: null,
    }),
    rotatePreviewLink: vi.fn().mockResolvedValue({ data: null, error: null }),
    revokePreviewLink: vi.fn().mockResolvedValue({ data: null, error: null }),
    listRecipients: vi.fn().mockResolvedValue({ data: [], error: null }),
  }),
}))

const metrics: TextMetrics = {
  words: 10,
  characters: 50,
  sentences: 2,
  readingTimeMinutes: 1,
  pages: 0.1,
}

const DOCUMENT_TITLE = "Carta"

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

function renderExportTab(overrides: {
  onExportPdf: () => Promise<boolean | void> | boolean | void
  onExportDocx: () => Promise<boolean | void> | boolean | void
}) {
  act(() => {
    root?.render(
      <PropertiesPanel
        tab="share"
        writingId="writing-1"
        writingTitle={DOCUMENT_TITLE}
        lifecycle="server-confirmed"
        status="draft"
        artifactType="agent"
        visibility="private"
        metrics={metrics}
        onStatusChange={vi.fn()}
        onArtifactTypeChange={vi.fn()}
        onVisibilityChange={vi.fn()}
        onExportPdf={overrides.onExportPdf}
        onExportDocx={overrides.onExportDocx}
      />,
    )
  })
}

function findButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.trim() === text)
  if (!button) {
    throw new Error(`No button found with text "${text}". Buttons: ${Array.from(container.querySelectorAll("button")).map((el) => el.textContent).join(", ")}`)
  }
  return button
}

function hasButtonText(text: string): boolean {
  return Array.from(container.querySelectorAll("button")).some((el) => el.textContent?.trim() === text)
}

function actionToast(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="document-action-toast"]')
}

async function clickAndFlush(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("PropertiesPanel export feedback (EXP-05)", () => {
  it("shows no feedback and no error when the export reports a dialog cancel (returns false)", async () => {
    const onExportPdf = vi.fn().mockResolvedValue(false)
    renderExportTab({ onExportPdf, onExportDocx: vi.fn() })

    await clickAndFlush(findButtonByText("PDF (.pdf)"))

    expect(onExportPdf).toHaveBeenCalledTimes(1)
    expect(actionToast()).toBeNull()
  })

  it.fails("shows the source-attributed success toast when the export genuinely wrote a file (returns true)", async () => {
    const onExportPdf = vi.fn().mockResolvedValue(true)
    renderExportTab({ onExportPdf, onExportDocx: vi.fn() })

    await clickAndFlush(findButtonByText("PDF (.pdf)"))

    const toast = actionToast()
    expect(toast?.getAttribute("data-notice")).toBe("success")
    expect(toast?.textContent).toBe(`PDF export for ‘${DOCUMENT_TITLE}’ is ready`)
  })

  it.fails("shows a source-attributed error, never a success message, when the export rejects (write failure)", async () => {
    const onExportPdf = vi.fn().mockRejectedValue(new Error("disk full"))
    renderExportTab({ onExportPdf, onExportDocx: vi.fn() })

    await clickAndFlush(findButtonByText("PDF (.pdf)"))

    const toast = actionToast()
    expect(toast?.getAttribute("data-notice")).toBe("error")
    expect(toast?.textContent).toBe(`PDF export for ‘${DOCUMENT_TITLE}’ failed: disk full`)
    expect(toast?.textContent).not.toContain("is ready")
  })

  it("treats a void/undefined return the same as a dialog cancel, never as success (EXP-05 regression)", async () => {
    // Reproduces the exportBinary(`!currentWritingId`) contract before its
    // fix: an early return with no explicit `false` resolves the promise to
    // `undefined`, which `exported === false` does not catch.
    const onExportPdf = vi.fn().mockResolvedValue(undefined)
    renderExportTab({ onExportPdf, onExportDocx: vi.fn() })

    await clickAndFlush(findButtonByText("PDF (.pdf)"))

    expect(actionToast()).toBeNull()
  })

  it.fails("keeps PDF and Word in the Export menu and drops Markdown (.md)", async () => {
    renderExportTab({ onExportPdf: vi.fn(), onExportDocx: vi.fn() })

    expect(hasButtonText("PDF (.pdf)")).toBe(true)
    expect(hasButtonText("Word (.docx)")).toBe(true)
    expect(hasButtonText("Markdown (.md)")).toBe(false)
  })
})
