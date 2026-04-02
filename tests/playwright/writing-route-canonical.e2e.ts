import { expect, test } from "@playwright/test"

test("write route redirects UUID links to the canonical slug", async ({ page }) => {
  await page.goto("/perf/write-canonical/fixture-writing-id")

  await expect(page).toHaveURL("/perf/write-canonical/semantic-write-title")
  await expect(page.getByTestId("write-canonical-harness")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Semantic write fixture" })).toBeVisible()
  await expect(page.getByText("Canonical URL: /perf/write-canonical/semantic-write-title")).toBeVisible()
})

test("shared route loads on the slug URL and preserves canonical navigation", async ({ page }) => {
  await page.goto("/perf/shared-canonical/fixture-writing-id")

  await expect(page).toHaveURL("/perf/shared-canonical/semantic-write-title")
  await expect(page.getByTestId("shared-canonical-harness")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Semantic write fixture" })).toBeVisible()
  await expect(page.getByText("Fixture Author @fixture-author")).toBeVisible()

  await page.goto("/perf/shared-canonical/semantic-write-title")

  await expect(page).toHaveURL("/perf/shared-canonical/semantic-write-title")
  await expect(page.getByTestId("shared-canonical-harness")).toBeVisible()
})
