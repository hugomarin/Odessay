import { expect, test } from "@playwright/test"
import { openEditorHarness } from "./helpers/editor"

/**
 * STATE-03/STATE-04 (ODE-555) — revalidated after the original version of
 * this test was found stale (workflow/quality/capability-integration-map.md):
 *
 * 1. It ran on `/perf/write-harness`, whose hardcoded `writingId=
 *    "write-mobile-harness"` was never a persisted document — reselecting
 *    it went through the real `resolveHydrationOutcome` -> "unavailable" ->
 *    tab-reconciliation path (legitimate product behavior for a genuinely
 *    orphaned document, just tripped here by a synthetic id no real user
 *    could produce).
 * 2. Its own tab-reselection selector, `button[aria-label^="Open"]`, never
 *    matched a real tab (tabs are `<div role="button">`, not `<button>`) —
 *    the only real match on the page was Next.js's dev-tools overlay
 *    toggle, so "switch back to the original tab" never actually did.
 * 3. With both of those fixed, a THIRD, real, independent product bug
 *    surfaced: `editor-shell.tsx`'s hydration effect deferred the rich-mode
 *    scroll/selection restore via `window.requestAnimationFrame`, then
 *    immediately (same tick) called `setHydrationWritingId(null)` to mark
 *    hydration "done" -- which is this same effect's own dependency, so it
 *    triggered the effect's cleanup (`generationOwner.cancel(generation)`)
 *    racing the still-queued rAF callback with no ordering guarantee. Fixed
 *    in this same change (ODE-555): hydration is now only marked "done"
 *    from inside the deepest deferred callback that actually performs a
 *    restore, never before it runs.
 *
 * This test uses `/perf/editor-harness` (real persisted documents via
 * `forceNewWriting`/"New Artifact", never a synthetic id) and targets tabs
 * via `[data-editor-tab-id]` (stable, never collides -- unlike tab titles,
 * which repeat across multiple "Untitled artifact" tabs).
 */

const readScrollState = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({
    editorScrollTop: document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')?.scrollTop ?? 0,
    windowScrollY: window.scrollY,
    mainScrollTop: document.querySelector<HTMLElement>("main")?.scrollTop ?? 0,
  }))

const totalScroll = (state: { editorScrollTop: number; windowScrollY: number; mainScrollTop: number }) =>
  state.editorScrollTop + state.windowScrollY + state.mainScrollTop

test("STATE-03/04: a sibling tab starts clean and the original tab's own viewport is restored", async ({ page }) => {
  test.setTimeout(60_000)

  await openEditorHarness(page)

  // Defensive against a known race: forceNewWriting's own auto-create-one-tab
  // effect and openEditorHarness()'s "click New Artifact if empty" fallback
  // can both fire from one goto(), occasionally producing 2 tabs instead of
  // 1. Close down to exactly one, deterministically, rather than assuming.
  let tabIds = await page
    .locator("[data-editor-tab-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-editor-tab-id")))
  for (const extraId of tabIds.slice(1)) {
    await page
      .locator(`[data-editor-tab-id="${extraId}"]`)
      .getByRole("button", { name: /^Close/ })
      .click({ force: true })
  }
  await expect(page.locator("[data-editor-tab-id]")).toHaveCount(1)
  tabIds = await page
    .locator("[data-editor-tab-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-editor-tab-id")))
  const tabAId = tabIds[0]!

  const editor = page.locator(".odessay-editor-content")
  await editor.click()

  const longParagraph =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\n"
  const repeatedText = longParagraph.repeat(60)

  await editor.evaluate((element, text) => {
    const tipEditor = (
      element as HTMLElement & { editor?: { view?: { dispatch?: (tr: unknown) => void }; state?: unknown } }
    ).editor
    const view = tipEditor?.view
    if (view && typeof view.dispatch === "function") {
      const { state } = tipEditor as { state: { tr: { insertText: (text: string, pos?: number) => unknown } } }
      const tr = state.tr.insertText(text, 1)
      view.dispatch(tr)
    }
  }, repeatedText)

  await page.waitForTimeout(300)

  const editorWritingArea = page.locator('[data-testid="editor-writing-area"]')
  const scrollTarget = 3000
  await editorWritingArea.evaluate((element, target) => {
    element.scrollTop = target
  }, scrollTarget)
  await page.evaluate((target) => window.scrollTo(0, target), scrollTarget)
  await page.waitForTimeout(300)

  const aPre = await readScrollState(page)
  const aPreTotal = totalScroll(aPre)
  // The setup must actually produce a non-trivial scroll, or this test
  // proves nothing.
  expect(aPreTotal).toBeGreaterThan(1000)

  // Create a second, real, persisted document ("New Artifact").
  await page.getByRole("button", { name: "New Artifact" }).click()
  await expect(page.locator("[data-editor-tab-id]")).toHaveCount(2)
  const bTabIds = await page
    .locator("[data-editor-tab-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-editor-tab-id")))
  const tabBId = bTabIds.find((id) => id !== tabAId)!

  // STATE-03: B must start clean -- A's scroll must never leak into a
  // sibling tab. (The map's own note on the prior version of this test:
  // "never independently asserts a sibling tab's own scroll stays at
  // 0/clean" -- this is that missing assertion.)
  const bScroll = await readScrollState(page)
  expect(totalScroll(bScroll)).toBeLessThanOrEqual(50)

  // STATE-04: switching back to A restores A's own viewport.
  await page.locator(`[data-editor-tab-id="${tabAId}"]`).click()
  await page.waitForTimeout(500)
  const aPostFirst = await readScrollState(page)
  expect(Math.abs(totalScroll(aPostFirst) - aPreTotal)).toBeLessThanOrEqual(50)

  // Repeat the round trip once more: a fix that only works the first time
  // (e.g. a stale ref never reset) would pass the assertion above and fail
  // this one.
  await page.locator(`[data-editor-tab-id="${tabBId}"]`).click()
  await page.waitForTimeout(300)
  await page.locator(`[data-editor-tab-id="${tabAId}"]`).click()
  await page.waitForTimeout(500)
  const aPostSecond = await readScrollState(page)
  expect(Math.abs(totalScroll(aPostSecond) - aPreTotal)).toBeLessThanOrEqual(50)
})
