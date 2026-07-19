/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-382 — responsive Desk/Workspace row grid
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ArtifactTable } from "@/components/shared/artifact-table"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Row = { id: string; title: string }

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

describe("ArtifactTable responsive row contract", () => {
  it("keeps the minimum grid width inside the table scroller and forwards row rhythm", () => {
    act(() => {
      root?.render(
        <ArtifactTable<Row>
          groups={[{ items: [{ id: "one", title: "A long title" }] }]}
          columns={[
            {
              id: "title",
              label: "Writing",
              render: (row) => <span>{row.title}</span>,
            },
            {
              id: "status",
              label: "Status",
              width: "w-[152px]",
              render: () => <span>Draft</span>,
            },
          ]}
          getRowId={(row) => row.id}
          renderLeading={() => <button type="button">Select</button>}
          showHeader={false}
          tableClassName="min-w-[1040px]"
          rowCellClassName="py-6"
          leadingCellClassName="pt-[25px]"
        />,
      )
    })

    const table = container.querySelector("table")
    const scroller = table?.parentElement
    const cells = Array.from(container.querySelectorAll("td"))

    expect(table?.className).toContain("min-w-[1040px]")
    expect(scroller?.className).toContain("overflow-x-auto")
    expect(cells[0]?.className).toContain("pt-[25px]")
    expect(cells.slice(1).every((cell) => cell.className.includes("py-6"))).toBe(true)
  })
})
