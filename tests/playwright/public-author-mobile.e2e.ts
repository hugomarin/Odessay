import { expect, test } from "@playwright/test"

test("public author page stays readable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/perf/public-author-harness")

  await expect(page.getByTestId("author-header")).toBeVisible()
  await expect(page.getByTestId("author-avatar")).toHaveCSS("width", "48px")
  await expect(page.getByTestId("author-avatar")).toHaveCSS("height", "48px")
  await expect(page.getByTestId("author-header")).toContainText("Laura Castillo")
  await expect(page.getByTestId("public-writing-list")).toBeVisible()
  await expect(page.getByText("The problem with being understood")).toBeVisible()

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasOverflow).toBe(false)
})
