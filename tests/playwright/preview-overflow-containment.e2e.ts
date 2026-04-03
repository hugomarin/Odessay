import { expect, test } from "@playwright/test"

test.describe("preview overflow containment", () => {
  test("keeps page without horizontal scroll while wide table scrolls internally and long urls wrap", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" })

    await page.evaluate(() => {
      const container = document.createElement("section")
      container.id = "overflow-fixture"
      container.style.maxWidth = "660px"
      container.style.margin = "0 auto"
      container.innerHTML = `
        <div id="preview-body" class="prose-odessay odessay-rich-content">
        <p>URL case:</p>
        <p>
          <a href="https://www.kingarthurbaking.com/blog/2022/03/09/what-is-creamings-and-why-does-it-make-a-difference-in-gluten-free-cakes-and-cookies">
            https://www.kingarthurbaking.com/blog/2022/03/09/what-is-creamings-and-why-does-it-make-a-difference-in-gluten-free-cakes-and-cookies
          </a>
        </p>
        <p>
          https://www.tateandlyle.com/ingredient/dolcia-ultra-super-hyper-long-reference-link-for-overflow-validation-in-reading-views
        </p>
        <div class="prose-odessay-table-wrap" id="table-wrap">
          <table id="wide-table">
            <thead>
              <tr>
                <th style="min-width: 220px;">Col 1</th><th style="min-width: 220px;">Col 2</th><th style="min-width: 220px;">Col 3</th><th style="min-width: 220px;">Col 4</th>
                <th style="min-width: 220px;">Col 5</th><th style="min-width: 220px;">Col 6</th><th style="min-width: 220px;">Col 7</th><th style="min-width: 220px;">Col 8</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="min-width: 220px;">alpha</td><td style="min-width: 220px;">beta</td><td style="min-width: 220px;">gamma</td><td style="min-width: 220px;">delta</td>
                <td style="min-width: 220px;">epsilon</td><td style="min-width: 220px;">zeta</td><td style="min-width: 220px;">eta</td><td style="min-width: 220px;">theta</td>
              </tr>
            </tbody>
          </table>
        </div>
        </div>
      `
      document.body.appendChild(container)
    })

    const pageOverflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement
      return root.scrollWidth > root.clientWidth
    })
    expect(pageOverflow).toBe(false)

    const tableMetrics = await page.evaluate(() => {
      const table = document.querySelector("#wide-table")
      const tableWrap = document.querySelector("#table-wrap")
      const prose = document.querySelector("#preview-body")
      const firstLongLink = document.querySelector("#preview-body a")
      if (!(table instanceof HTMLElement)) {
        throw new Error("Missing #wide-table")
      }
      if (!(tableWrap instanceof HTMLElement)) {
        throw new Error("Missing #table-wrap")
      }
      if (!(prose instanceof HTMLElement)) {
        throw new Error("Missing #preview-body")
      }
      if (!(firstLongLink instanceof HTMLElement)) {
        throw new Error("Missing long link")
      }

      const style = window.getComputedStyle(tableWrap)
      return {
        overflowX: style.overflowX,
        scrollsInternally: tableWrap.scrollWidth > tableWrap.clientWidth && table.scrollWidth > table.clientWidth,
        linkContained: firstLongLink.scrollWidth <= prose.clientWidth,
      }
    })

    expect(tableMetrics.overflowX === "auto" || tableMetrics.overflowX === "visible").toBe(true)
    expect(tableMetrics.scrollsInternally).toBe(true)
    expect(tableMetrics.linkContained).toBe(true)
  })
})
