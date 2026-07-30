/** @vitest-environment happy-dom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsNav } from "@/components/settings/settings-nav"
import { ArchivedWritingsList } from "@/components/settings/archived-writings-list"
import type { DocumentService, WritingRecord, WritingSummary } from "@/lib/services/contracts/document-service"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/archived" }))

type ArchiveService = Pick<DocumentService, "listWritings" | "restoreWriting" | "permanentlyDeleteWriting" | "downloadWriting">
const archivedAt = "2026-07-29T12:00:00.000Z"

function row(index: number): WritingSummary {
  return {
    id: `writing-${index}`,
    authorId: "author-1",
    title: `Archived writing ${index}`,
    excerpt: null,
    slug: null,
    status: "draft",
    artifactType: "general",
    visibility: "private",
    parentId: null,
    correspondenceId: null,
    version: index + 1,
    deletedAt: archivedAt,
    createdAt: archivedAt,
    updatedAt: archivedAt,
    archiveState: "archived",
  }
}

function record(summary: WritingSummary): WritingRecord {
  return {
    ...summary,
    content: { markdown: "", richText: null, plainText: "", canonicalSource: "pending-document-contract" },
  }
}

function service(overrides: Partial<ArchiveService> = {}): ArchiveService {
  return {
    listWritings: vi.fn().mockResolvedValue({ data: [], error: null }),
    restoreWriting: vi.fn().mockResolvedValue({ data: null, error: null }),
    permanentlyDeleteWriting: vi.fn().mockResolvedValue({ data: undefined, error: null }),
    downloadWriting: vi.fn().mockResolvedValue({
      data: { writingId: "writing-1", format: "markdown", fileName: "Archived writing 1.md", mimeType: "text/markdown", bytes: new Uint8Array([35, 32, 79, 110, 101]) },
      error: null,
    }),
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root
const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

async function renderList(archiveService: ArchiveService) {
  await act(async () => { root.render(<ArchivedWritingsList service={archiveService} />) })
  await settle()
}

async function click(element: Element | null) {
  if (!element) throw new Error("Expected an element to click")
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await Promise.resolve()
  })
}

function button(name: string, scope: ParentNode = document) {
  return Array.from(scope.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name) ?? null
}

async function chooseAction(writingId: string, name: string) {
  const target = document.querySelector(`[data-testid="archived-writing-${writingId}"]`)
  await click(button("Writing actions", target ?? document))
  await click(Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent?.trim() === name) ?? null)
  await settle()
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:archive"), revokeObjectURL: vi.fn() })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("Archived writings settings", () => {
  it("shows only the final settings navigation", () => {
    act(() => root.render(<SettingsNav />))
    expect(Array.from(container.querySelectorAll("a"), (link) => link.textContent)).toEqual(["Account", "Status", "Archived writings"])
    expect(container.textContent).not.toContain("Privacy")
    expect(container.textContent).not.toContain("Billing")
  })

  it("renders loading then the empty state from one paginated summary query", async () => {
    let resolveList!: (value: Awaited<ReturnType<ArchiveService["listWritings"]>>) => void
    const pending = new Promise<Awaited<ReturnType<ArchiveService["listWritings"]>>>((resolve) => { resolveList = resolve })
    const list = vi.fn().mockReturnValue(pending)
    await act(async () => { root.render(<ArchivedWritingsList service={service({ listWritings: list })} />) })
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading archived writings")
    resolveList({ data: [], error: null })
    await settle()
    expect(container.textContent).toContain("No archived writings")
    expect(list).toHaveBeenCalledWith({ includeDeleted: true, archivedOnly: true, limit: 26, offset: 0 })
  })

  it("shows a load error and retries the same page", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "DB_ERROR", message: "offline", retryable: true } })
      .mockResolvedValueOnce({ data: [], error: null })
    await renderList(service({ listWritings: list }))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not load archived writings. offline")
    await click(button("Retry", container))
    await settle()
    expect(list).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain("No archived writings")
  })

  it("restores with the row version and keeps other rows actionable while pending", async () => {
    let finishRestore!: (value: Awaited<ReturnType<ArchiveService["restoreWriting"]>>) => void
    const restore = vi.fn().mockReturnValue(new Promise((resolve) => { finishRestore = resolve }))
    const list = vi.fn().mockResolvedValue({ data: [row(1), row(2)], error: null })
    await renderList(service({ listWritings: list, restoreWriting: restore }))
    await chooseAction("writing-1", "Restore")
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ writingId: "writing-1", version: 2 }))
    expect((button("Writing actions", document.querySelector('[data-testid="archived-writing-writing-1"]')!) as HTMLButtonElement).disabled).toBe(true)
    expect((button("Writing actions", document.querySelector('[data-testid="archived-writing-writing-2"]')!) as HTMLButtonElement).disabled).toBe(false)
    finishRestore({ data: record(row(1)), error: null })
    await settle()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it("downloads the archived markdown with the service-provided filename", async () => {
    const download = vi.fn().mockResolvedValue({
      data: { writingId: "writing-1", format: "markdown", fileName: "Archive.md", mimeType: "text/markdown", bytes: new Uint8Array([65]) },
      error: null,
    })
    await renderList(service({ listWritings: vi.fn().mockResolvedValue({ data: [row(1)], error: null }), downloadWriting: download }))
    await chooseAction("writing-1", "Download")
    expect(download).toHaveBeenCalledWith({ writingId: "writing-1" })
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:archive")
  })

  it("cancels and then confirms permanent deletion", async () => {
    const remove = vi.fn().mockResolvedValue({ data: undefined, error: null })
    const list = vi.fn().mockResolvedValue({ data: [row(1)], error: null })
    await renderList(service({ listWritings: list, permanentlyDeleteWriting: remove }))
    await chooseAction("writing-1", "Delete permanently")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("cannot be undone")
    await click(button("Cancel"))
    expect(remove).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await chooseAction("writing-1", "Delete permanently")
    await click(button("Delete permanently"))
    await settle()
    expect(remove).toHaveBeenCalledWith({ writingId: "writing-1" })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it("keeps action failures on their row and retries the failed action", async () => {
    const restore = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "UNAVAILABLE", message: "network", retryable: true } })
      .mockResolvedValueOnce({ data: null, error: null })
    const list = vi.fn().mockResolvedValue({ data: [row(1), row(2)], error: null })
    await renderList(service({ listWritings: list, restoreWriting: restore }))
    await chooseAction("writing-1", "Restore")
    const first = document.querySelector('[data-testid="archived-writing-writing-1"]')!
    const second = document.querySelector('[data-testid="archived-writing-writing-2"]')!
    expect(first.querySelector('[role="alert"]')?.textContent).toContain("Could not restore this writing.")
    expect(second.querySelector('[role="alert"]')).toBeNull()
    await click(button("Retry", first))
    await settle()
    expect(restore).toHaveBeenCalledTimes(2)
  })

  it("paginates forward and backward with the catalog offsets", async () => {
    const firstPage = Array.from({ length: 26 }, (_, index) => row(index))
    const list = vi.fn().mockImplementation(async ({ offset = 0 }) => ({ data: offset === 0 ? firstPage : [row(30)], error: null }))
    await renderList(service({ listWritings: list }))
    expect(container.querySelectorAll('[data-testid^="archived-writing-"]')).toHaveLength(25)
    await click(button("Next", container))
    await settle()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 }))
    expect(container.textContent).toContain("Archived writing 30")
    await click(button("Previous", container))
    await settle()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }))
  })
})
