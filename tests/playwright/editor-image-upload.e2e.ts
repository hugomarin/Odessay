import { expect, test } from "@playwright/test"
import { openEditorHarness, switchToMarkdown, markdownTextarea } from "./helpers/editor"

test("image upload inserts stable URL and round-trips through markdown", async ({ page }) => {
  await openEditorHarness(page)

  const mockAssetId = "mock-asset-id"
  const mockUrl = `/api/writing-assets/${mockAssetId}`

  await page.route("**/api/writings/perf-harness-writing/images", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        data: { assetId: mockAssetId, url: mockUrl, alt: "Test alt" },
        error: null,
      }),
    })
  })

  // Open image modal via toolbar
  await page.getByRole("button", { name: "Image" }).click()
  await expect(page.getByRole("dialog", { name: "Insert image" })).toBeVisible()

  // Simulate file selection and upload
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-image-data"),
  })

  await page.getByRole("button", { name: "Insert image" }).click()

  // Verify image node is present in the editor
  await expect(page.locator(".odessay-editor-content img")).toBeVisible()
  const img = page.locator(".odessay-editor-content img")
  await expect(img).toHaveAttribute("src", mockUrl)
  await expect(img).toHaveAttribute("alt", "Test alt")

  // Switch to markdown and verify stable URL serialization
  await switchToMarkdown(page)
  const textarea = await markdownTextarea(page)
  await expect(textarea).toHaveValue(`![Test alt](${mockUrl})`)
})

test("image modal rejects oversized files", async ({ page }) => {
  await openEditorHarness(page)

  await page.getByRole("button", { name: "Image" }).click()
  await expect(page.getByRole("dialog", { name: "Insert image" })).toBeVisible()

  const fileInput = page.locator('input[type="file"]')
  // Create a buffer larger than 5MB
  const largeBuffer = Buffer.alloc(6 * 1024 * 1024)
  await fileInput.setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: largeBuffer,
  })

  await expect(page.getByText("File too large")).toBeVisible()
})
