import { expect, test } from "@playwright/test"

test("ODE-126: clicking + from an existing writing creates a new writing with valid ID", async ({ page, context }) => {
  // Load auth state
  await context.addCookies(require('../../playwright-auth.json').cookies)
  
  // Navigate to desk and open any existing writing, or go directly to write
  await page.goto("/desk")
  await page.waitForURL(/\/desk/, { timeout: 10000 })
  
  // Click the "New Artifact" button in sidebar or desk
  const newWritingButton = page.locator('a[href="/write"]').first()
  if (await newWritingButton.isVisible().catch(() => false)) {
    await newWritingButton.click()
  } else {
    await page.goto("/write")
  }
  
  // Wait for the blank /write to create a writing and redirect
  await page.waitForURL(/\/write\/[a-f0-9-]+$/, { timeout: 15000 })
  const firstUrl = page.url()
  const firstId = firstUrl.split("/write/")[1]
  console.log("First writing ID:", firstId)
  expect(firstId).toMatch(/^[a-f0-9-]{36}$/)
  
  // Wait for editor
  await page.waitForSelector('[data-testid="editor-writing-area"]', { timeout: 10000 })
  await page.waitForTimeout(1000)
  
  // Click the + button in tabs to create another new writing
  const plusButton = page.locator('button[aria-label="New Artifact"]')
  await plusButton.click()
  
  // Wait for navigation to complete
  await page.waitForTimeout(3000)
  
  // The URL should have changed to a NEW writing ID
  const secondUrl = page.url()
  const secondId = secondUrl.split("/write/")[1]
  console.log("Second writing ID:", secondId)
  expect(secondId).toMatch(/^[a-f0-9-]{36}$/)
  expect(secondId).not.toBe(firstId)
  
  // The editor should show the new writing (not the old one)
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()
  
  // Third click — should create ANOTHER new writing (no regression)
  await plusButton.click()
  await page.waitForTimeout(3000)
  
  const thirdUrl = page.url()
  const thirdId = thirdUrl.split("/write/")[1]
  console.log("Third writing ID:", thirdId)
  expect(thirdId).toMatch(/^[a-f0-9-]{36}$/)
  expect(thirdId).not.toBe(firstId)
  expect(thirdId).not.toBe(secondId)
})
