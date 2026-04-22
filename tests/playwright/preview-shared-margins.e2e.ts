import { expect, test } from "@playwright/test"

test.describe("preview shared margins", () => {
  test("renders shared margin highlights for a valid preview token", async ({ page }) => {
    await page.goto("/preview/fixturepreviewoktoken0001", { waitUntil: "domcontentloaded" })

    // Intercept the preview margins API and return a shared margin
    await page.route("**/api/margins/preview?token=fixturepreviewoktoken0001", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "margin-fixture-shared-1",
              writing_id: "fixture-writing-id",
              anchor_start: 0,
              anchor_end: 7,
              anchor_text: "Preview",
              note: "Shared annotation for preview",
              shared: true,
              shared_at: "2026-04-22T10:00:00.000Z",
              created_at: "2026-04-22T10:00:00.000Z",
              updated_at: "2026-04-22T10:00:00.000Z",
            },
          ],
          error: null,
        }),
      })
    })

    // Wait for the highlight layer to apply shared margins
    await page.waitForSelector("#preview-body .hl", { timeout: 5000 })

    const highlight = page.locator("#preview-body .hl")
    await expect(highlight).toHaveCount(1)
    await expect(highlight).toHaveAttribute("data-id", "margin-fixture-shared-1")
    await expect(highlight).toHaveClass(/annotated/)
  })

  test("does not render highlights when no shared margins exist", async ({ page }) => {
    await page.goto("/preview/fixturepreviewoktoken0001", { waitUntil: "domcontentloaded" })

    await page.route("**/api/margins/preview?token=fixturepreviewoktoken0001", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], error: null }),
      })
    })

    // Give HighlightLayer time to run (it executes in useEffect)
    await page.waitForTimeout(500)

    const highlights = page.locator("#preview-body .hl")
    await expect(highlights).toHaveCount(0)
  })
})
