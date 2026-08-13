/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackupImageModal } from "@/components/editor/modals/backup-image-modal"

let container: HTMLDivElement
let root: Root | null = null

describe("BackupImageModal", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it("explains the one-way source replacement before confirming", () => {
    const onConfirm = vi.fn()
    act(() => {
      root = createRoot(container)
      root.render(
        <BackupImageModal
          open
          source="/Users/hugo/image.png"
          uploading={false}
          error={null}
          onOpenChange={() => {}}
          onConfirm={onConfirm}
        />,
      )
    })

    expect(document.body.textContent).toContain("will be replaced with an online URL")
    expect(document.body.textContent).toContain("original image file will remain")
    expect(document.body.textContent).toContain("/Users/hugo/image.png")
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Back up and replace"),
    )
    act(() => confirm?.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("keeps the dialog open and exposes a retryable error", () => {
    act(() => {
      root = createRoot(container)
      root.render(
        <BackupImageModal
          open
          source="images/photo.png"
          uploading={false}
          error="Document not yet synced — retry in a moment"
          onOpenChange={() => {}}
          onConfirm={() => {}}
        />,
      )
    })

    expect(document.querySelector("[role='alert']")?.textContent).toContain("retry in a moment")
    expect(document.querySelector<HTMLButtonElement>("[data-testid='backup-local-image-dialog'] button:last-of-type")?.disabled).toBe(false)
  })
})
