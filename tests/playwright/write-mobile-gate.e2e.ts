import { expect, test } from "@playwright/test"

test("write route shows a desktop-only gate on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/perf/write-harness")

  await expect(page.getByTestId("write-mobile-gate")).toBeVisible()
  await expect(page.getByRole("link", { name: "Artifact Studio" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Ir al desk" })).toBeVisible()
  await expect(
    page.getByText(
      "La escritura en Artifact Studio está pensada para pantalla grande. Abre Artifact Studio en tu computadora para escribir.",
    ),
  ).toBeVisible()

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/perf/write-harness")

  await expect(page.getByTestId("write-mobile-gate")).toBeHidden()
  await expect(page.getByTestId("editor-topbar")).toBeVisible()
})
