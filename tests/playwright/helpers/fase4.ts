import { existsSync } from "node:fs"
import { expect, type ConsoleMessage, type Locator, type Page } from "@playwright/test"

export const FASE4_PLAYWRIGHT_ASSET_INVENTORY = {
  usableAsIs: [
    "tests/playwright/helpers/editor.ts",
    "tests/playwright/write-new-first-paste.e2e.ts",
    "tests/playwright/write-blank-lifecycle.e2e.ts",
    "tests/playwright/preview-valid-token.e2e.ts",
    "tests/playwright/desk-shared-tab.e2e.ts",
    "tests/playwright/writing-route-canonical.e2e.ts",
    "app/perf/write-new-harness/page.tsx",
    "app/perf/write-harness/page.tsx",
    "app/perf/desk-shared-harness/page.tsx",
    "app/perf/reading-harness/page.tsx",
    "app/perf/public-author-harness/page.tsx",
  ],
  usableAsPattern: [
    "tests/playwright/preview-overflow-containment.e2e.ts",
    "tests/playwright/preview-shared-margins.e2e.ts",
    "tests/playwright/public-author-mobile.e2e.ts",
    "tests/playwright/reading-mobile.e2e.ts",
    "tests/playwright/write-transient-race.e2e.ts",
  ],
  discardForClosureFlow: [
    "tests/playwright/ode-126-new-writing-fix.e2e.ts",
    "scripts/capture-editor-trace.mjs",
    "scripts/capture-reading-trace.mjs",
  ],
} as const

export async function assertFase4AssetInventory() {
  const inventoriedAssets = Object.values(FASE4_PLAYWRIGHT_ASSET_INVENTORY).flat()

  expect(FASE4_PLAYWRIGHT_ASSET_INVENTORY.usableAsIs.length).toBeGreaterThanOrEqual(6)
  expect(FASE4_PLAYWRIGHT_ASSET_INVENTORY.usableAsPattern.length).toBeGreaterThanOrEqual(3)
  expect(FASE4_PLAYWRIGHT_ASSET_INVENTORY.discardForClosureFlow).toContain(
    "tests/playwright/ode-126-new-writing-fix.e2e.ts",
  )

  for (const assetPath of inventoriedAssets) {
    expect(existsSync(assetPath), `Inventoried Playwright asset is missing: ${assetPath}`).toBe(true)
  }
}

async function expectNoConsoleErrors(
  page: Page,
  run: () => Promise<void>,
  options?: { allowlist?: RegExp[] },
) {
  const consoleErrors: string[] = []
  const allowlist = options?.allowlist ?? []

  const handleConsole = (message: ConsoleMessage) => {
    if (message.type() !== "error") return

    const text = message.text()
    if (allowlist.some((pattern) => pattern.test(text))) return

    consoleErrors.push(text)
  }

  page.on("console", handleConsole)

  try {
    await run()
  } finally {
    page.off("console", handleConsole)
  }

  expect(consoleErrors).toEqual([])
}

export async function openWriteNewHarness(page: Page) {
  await page.goto("/perf/write-new-harness")
  await expect(page.getByTestId("editor-topbar")).toBeVisible()
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()
}

export async function assertWritePathBootstrap(page: Page) {
  await expect.poll(() => page.evaluate(() => window.location.pathname)).toMatch(
    /\/write\/[0-9a-f-]{36}$/,
  )
  await expect(page.getByText("Saved locally")).toBeVisible()
}

export async function openStableWriteHarness(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/perf/write-harness")
  await expect(page.getByTestId("write-mobile-gate")).toBeHidden()
  await expect(page.getByTestId("editor-topbar")).toBeVisible()
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()
}

export function richEditor(page: Page): Locator {
  return page.locator(".odessay-editor-content")
}

export async function assertWritePersistenceOnStableHarness(page: Page, text: string) {
  const editor = richEditor(page)
  await editor.click()
  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+A`)
  await page.keyboard.insertText(text)
  await expect(editor).toContainText(text)

  await page.reload()
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()
  await expect(richEditor(page)).toContainText(text)
}

export async function assertPreviewFixture(page: Page) {
  await expectNoConsoleErrors(page, async () => {
    await page.goto("/preview/fixturepreviewoktoken0001", { waitUntil: "domcontentloaded" })
    await expect(page.getByText("Read-only UX preview")).toBeVisible()
    await expect(page.getByTestId("preview-body")).toContainText("Preview fixture heading")
    await expect(page.getByTestId("preview-body").locator("table")).toBeVisible()

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(hasOverflow).toBe(false)
  })
}

export async function assertSharedClosureSurface(page: Page) {
  await page.goto("/perf/desk-shared-harness")
  await expect(page.getByTestId("desk-view-tab-shared")).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("desk-shared-writing-item")).toBeVisible()
  await expect(page.getByText("Fixture Author @fixture-author")).toBeVisible()

  await page.goto("/perf/shared-canonical/fixture-writing-id")
  await expect(page).toHaveURL("/perf/shared-canonical/semantic-write-title")
  await expect(page.getByTestId("shared-canonical-harness")).toBeVisible()
}

export async function assertPublicClosureSurface(page: Page) {
  await page.goto("/perf/public-author-harness", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("author-header")).toBeVisible()
  await expect(page.getByTestId("public-writing-list")).toBeVisible()
  await expect(page.getByText("The problem with being understood")).toBeVisible()
}

export async function assertReadingHarness(page: Page) {
  await page.goto("/perf/reading-harness", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("reading-body")).toBeVisible()
  await expect(page.getByTestId("reading-body").locator("table")).toBeVisible()

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasOverflow).toBe(false)
}

export async function assertCanonicalHarnesses(page: Page) {
  await page.goto("/perf/write-canonical/fixture-writing-id")
  await page.waitForURL("**/perf/write-canonical/semantic-write-title", { timeout: 15_000 })
  await expect(page).toHaveURL("/perf/write-canonical/semantic-write-title")
  await expect(page.getByTestId("write-canonical-harness")).toBeVisible()

  await page.goto("/perf/shared-canonical/semantic-write-title")
  await expect(page).toHaveURL("/perf/shared-canonical/semantic-write-title")
  await expect(page.getByTestId("shared-canonical-harness")).toBeVisible()
}
