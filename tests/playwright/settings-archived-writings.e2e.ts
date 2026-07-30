import { expect, test } from "@playwright/test"

test.describe("Archived writings settings", () => {
  test("shows the final navigation and empty archive state", async ({ page }) => {
    await page.goto("/evidence/settings-archived?state=empty")

    await expect(page.getByRole("link", { name: "Archived writings" })).toHaveAttribute("href", "/settings/archived")
    await expect(page.getByText("No archived writings")).toBeVisible()
    await expect(page.getByText("Soft-deleted writings will appear here.")).toBeVisible()
  })

  test("downloads and restores an archived writing", async ({ page }) => {
    await page.goto("/evidence/settings-archived")
    const row = page.getByTestId("archived-writing-archive-1")

    await row.getByRole("button", { name: "Writing actions" }).click()
    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: "Download" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe("Novel notes.md")

    await row.getByRole("button", { name: "Writing actions" }).click()
    await page.getByRole("menuitem", { name: "Restore" }).click()
    await expect(row).toHaveCount(0)
  })

  test("requires confirmation and respects cancel before permanent deletion", async ({ page }) => {
    await page.goto("/evidence/settings-archived")
    const row = page.getByTestId("archived-writing-archive-2")

    await row.getByRole("button", { name: "Writing actions" }).click()
    await page.getByRole("menuitem", { name: "Delete permanently" }).click()
    await expect(page.getByRole("dialog")).toContainText("cannot be undone")
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(row).toBeVisible()

    await row.getByRole("button", { name: "Writing actions" }).click()
    await page.getByRole("menuitem", { name: "Delete permanently" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Delete permanently" }).click()
    await expect(row).toHaveCount(0)
  })

  test("paginates archived rows", async ({ page }) => {
    await page.goto("/evidence/settings-archived")
    await expect(page.getByTestId("archived-writing-archive-27")).toHaveCount(0)
    await page.getByRole("button", { name: "Next", exact: true }).click()
    await expect(page.getByTestId("archived-writing-archive-27")).toBeVisible()
    await page.getByRole("button", { name: "Previous" }).click()
    await expect(page.getByTestId("archived-writing-archive-1")).toBeVisible()
  })
})
