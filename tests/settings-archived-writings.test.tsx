/** @vitest-environment happy-dom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsNav } from "@/components/settings/settings-nav"
import { ArchivedWritingsList } from "@/components/settings/archived-writings-list"

const mocks = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn(), remove: vi.fn(), download: vi.fn() }))
vi.mock("next/navigation", () => ({ usePathname: () => "/settings/archived" }))
vi.mock("@/lib/services/document-service-factory", () => ({ getDocumentService: async () => ({ listWritings: mocks.list, restoreWriting: mocks.restore, permanentlyDeleteWriting: mocks.remove, downloadWriting: mocks.download }) }))

let container: HTMLDivElement; let root: Root
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })

describe("Archived writings settings", () => {
  it("shows only the final settings navigation", () => {
    act(() => root.render(<SettingsNav />))
    expect(Array.from(container.querySelectorAll("a"), (link) => link.textContent)).toEqual(["Account", "Status", "Archived writings"])
    expect(container.textContent).not.toContain("Privacy"); expect(container.textContent).not.toContain("Billing")
  })
  it("renders empty state from one paginated summary query", async () => {
    mocks.list.mockResolvedValue({ data: [], error: null })
    await act(async () => root.render(<ArchivedWritingsList />))
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).toContain("No archived writings")
    expect(mocks.list).toHaveBeenCalledWith({ includeDeleted: true, archivedOnly: true, limit: 26, offset: 0 })
  })
})
