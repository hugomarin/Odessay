import { expect, test } from "@playwright/test"

test("preview operational failure shows unavailable state", async ({ page }) => {
  await page.goto("/preview/fixturepreviewunavailable001")

  await expect(page.getByRole("heading", { name: "Preview temporarily unavailable" })).toBeVisible()
  await expect(page.getByText("Artifact Studio could not load this artifact right now.")).toBeVisible()
})
