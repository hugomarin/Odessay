import { expect, test } from "@playwright/test"

test("reading view stays usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/perf/reading-harness")

  await expect(page.getByTestId("reading-chrome")).toBeVisible()
  await expect(page.getByTestId("reading-body-shell")).toBeVisible()
  await expect(page.getByTestId("reading-body")).toBeVisible()

  const title = page.locator("#reading-text h1")
  await expect(title).toBeVisible()
  await expect(title).toHaveCSS("font-size", "24px")

  const body = page.getByTestId("reading-body")
  await expect(body).toHaveCSS("font-size", "16px")
  await expect(body).toHaveCSS("line-height", "28px")

  const shellWidth = await page.getByTestId("reading-body-shell").evaluate((element) => element.getBoundingClientRect().width)
  expect(shellWidth).toBeGreaterThan(360)

  await page.getByLabel("Open margins").click()
  await expect(page.getByLabel("Close margins")).toBeVisible()
  await expect(page.getByTestId("reading-margin-panel")).toBeVisible()

  await expect.poll(async () => {
    return page.getByTestId("reading-margin-panel").evaluate((element) => element.getBoundingClientRect().width)
  }).toBeGreaterThan(250)

  const finalPanelWidth = await page
    .getByTestId("reading-margin-panel")
    .evaluate((element) => element.getBoundingClientRect().width)
  expect(finalPanelWidth).toBeLessThanOrEqual(296)

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasOverflow).toBe(false)
})
