import { expect, test } from "@playwright/test"

test.describe("Fase 9 document catalog view contract", () => {
  test("state copy is visible and keyboard-readable on the stable harness", async ({ page }) => {
    await page.goto("/perf/document-state-harness")

    const harness = page.getByTestId("document-state-harness")
    await expect(harness).toBeVisible()

    const expectedStates = [
      ["cloud-only", "Cloud only"],
      ["local-only", "Local only"],
      ["synced", "Synced"],
      ["pending", "Syncing"],
    ] as const

    for (const [state, label] of expectedStates) {
      const badge = harness.locator(`[data-document-state="${state}"]`)
      await expect(badge).toHaveCount(1)
      await expect(badge).toHaveAttribute("role", "status")
      await expect(badge).toHaveAttribute("aria-label", `Artifact state: ${label}`)
      await expect(badge).toContainText(label)
    }
  })

  test("Desk keeps artifact rows and controls reachable by keyboard", async ({ page }) => {
    await page.goto("/perf/desk-harness?state=selection")

    await expect(page.getByTestId("desk-sheet")).toBeVisible()
    const rows = page.getByTestId("desk-artifact-row")
    await expect(rows).toHaveCount(8)
    const firstCheckbox = page.getByTestId("desk-artifact-row-checkbox").first()
    await expect(firstCheckbox).toHaveAttribute("role", "checkbox")
    await expect(firstCheckbox).toHaveAttribute("aria-checked", "true")

    await firstCheckbox.focus()
    await expect(firstCheckbox).toBeFocused()
    await page.keyboard.press("Space")
    await expect(firstCheckbox).toHaveAttribute("aria-checked", "false")
  })

  test("web explains the desktop filesystem boundary", async ({ page }) => {
    await page.goto("/perf/workspace-boundary-harness")

    await expect(page.getByTestId("workspace-desktop-required")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Workspaces live on the desktop app" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Desk" })).toHaveAttribute("href", "/desk")
  })
})
