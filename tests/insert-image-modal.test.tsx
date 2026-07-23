/**
 * @vitest-environment happy-dom
 *
 * ODE-404 — Visual/UX contract of InsertImageModal for the not-yet-synced
 * error path: the actionable service message renders in the SAME error slot
 * (red text under Alt text) and the submit button re-enables so the user can
 * retry without closing the modal. The component itself is unchanged; these
 * tests lock the contract against the new desktop error path.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InsertImageModal } from "@/components/editor/modals/insert-image-modal"

const uploadImageAsset = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/asset-service-factory", () => ({
  getAssetService: () => ({ uploadImageAsset }),
}))

let container: HTMLDivElement
let root: Root | null = null

function render(ui: React.ReactElement) {
  act(() => {
    root = createRoot(container)
    root.render(ui)
  })
}

async function selectPngFile() {
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
  const file = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" })
  Object.defineProperty(fileInput, "files", { value: [file] })
  await act(async () => {
    fileInput.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function submitForm() {
  const form = document.querySelector("form")!
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
}

describe("InsertImageModal — not-yet-synced error path (ODE-404)", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    uploadImageAsset.mockReset()
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it("renders the actionable message in the destructive error slot and re-enables retry", async () => {
    uploadImageAsset.mockResolvedValue({
      data: null,
      error: { code: "UNAVAILABLE", message: "Document not yet synced — retry in a moment", retryable: true },
    })
    render(
      <InsertImageModal open writingId="doc-1" onOpenChange={() => {}} onConfirm={() => {}} />,
    )

    await selectPngFile()
    await submitForm()

    // Same placement and style as every other upload error: red text inside the form.
    const errorText = document.querySelector("form p.text-destructive")
    expect(errorText?.textContent).toBe("Document not yet synced — retry in a moment")

    // Manual retry is possible without closing the modal: file kept, button enabled.
    const submitButton = document.querySelector<HTMLButtonElement>('button[type="submit"]')!
    expect(submitButton.disabled).toBe(false)
    expect(submitButton.textContent).toBe("Insert image")

    uploadImageAsset.mockResolvedValue({
      data: { assetId: "a1", writingId: "doc-1", url: "https://cdn/x.png", alt: null, mimeType: "image/png", sizeBytes: 3 },
      error: null,
    })
    await submitForm()
    expect(uploadImageAsset).toHaveBeenCalledTimes(2)
  })
})
