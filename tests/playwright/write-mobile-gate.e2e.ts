import { expect, test } from "@playwright/test"

test("write route shows a desktop-only gate on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/perf/write-harness")

  await expect(page.getByTestId("write-mobile-gate")).toBeVisible()
  await expect(page.getByRole("link", { name: "Artifact Studio" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Go to desk" })).toBeVisible()
  await expect(
    page.getByText(
      "Writing in Artifact Studio is built for a large screen. Open Artifact Studio on your computer to write.",
    ),
  ).toBeVisible()

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/perf/write-harness")

  await expect(page.getByTestId("write-mobile-gate")).toBeHidden()
  await expect(page.getByTestId("editor-topbar")).toBeVisible()
})
