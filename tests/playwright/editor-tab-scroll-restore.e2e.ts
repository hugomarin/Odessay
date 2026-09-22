import { expect, test } from "@playwright/test"
import { markdownTextarea, openEditorHarness, switchToMarkdown } from "./helpers/editor"

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
 * 4. A follow-up review caught the same class of bug still present in
 *    markdown mode: `queueMarkdownSelectionRestore` is a shared, module-ref
 *    based queue with its own internal deferred re-applies and no built-in
 *    notion of "which document this restore was for" -- a hydration restore
 *    queued for A could still land on B's now-current DOM after a fast A->B
 *    switch. Fixed by threading `isStillValid`/`onSettled` through the queue
 *    so hydration only marks itself "done" once its restore has genuinely
 *    settled (applied or skipped as stale). Covered below by a dedicated
 *    markdown-mode test.
 *
 * This test uses `/perf/editor-harness` (real persisted documents via
 * `forceNewWriting`/"New Artifact", never a synthetic id) and targets tabs
 * via `[data-editor-tab-id]` (stable, never collides -- unlike tab titles,
 * which repeat across multiple "Untitled artifact" tabs).
 *
 * Scroll comparisons check each axis (`editorScrollTop`, `windowScrollY`,
 * `mainScrollTop`) individually rather than a single summed total: a summed
 * comparison would mask a bug where two axes' values get swapped between
 * the wrong document owners, since the sum would still match. The two
 * scenarios below deliberately drive `editorScrollTop` and `windowScrollY`
 * to different target values for exactly this reason.
 */

type ScrollState = { editorScrollTop: number; windowScrollY: number; mainScrollTop: number }

const readScrollState = (page: import("@playwright/test").Page): Promise<ScrollState> =>
  page.evaluate(() => ({
    editorScrollTop: document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')?.scrollTop ?? 0,
    windowScrollY: window.scrollY,
    mainScrollTop: document.querySelector<HTMLElement>("main")?.scrollTop ?? 0,
  }))

const expectScrollClean = (state: ScrollState) => {
  expect(state.editorScrollTop).toBeLessThanOrEqual(50)
  expect(state.windowScrollY).toBeLessThanOrEqual(50)
  expect(state.mainScrollTop).toBeLessThanOrEqual(50)
}

const expectScrollRestored = (before: ScrollState, after: ScrollState) => {
  expect(Math.abs(after.editorScrollTop - before.editorScrollTop)).toBeLessThanOrEqual(50)
  expect(Math.abs(after.windowScrollY - before.windowScrollY)).toBeLessThanOrEqual(50)
  expect(Math.abs(after.mainScrollTop - before.mainScrollTop)).toBeLessThanOrEqual(50)
}

const closeExtraTabsDownToOne = async (page: import("@playwright/test").Page) => {
  // Defensive against a known race: forceNewWriting's own auto-create-one-tab
  // effect and openEditorHarness()'s "click New Artifact if empty" fallback
  // can both fire from one goto(), occasionally producing 2 tabs instead of
  // 1. Close down to exactly one, deterministically, rather than assuming.
  const tabIds = await page
    .locator("[data-editor-tab-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-editor-tab-id")))
  for (const extraId of tabIds.slice(1)) {
    await page
      .locator(`[data-editor-tab-id="${extraId}"]`)
      .getByRole("button", { name: /^Close/ })
      .click({ force: true })
  }
  await expect(page.locator("[data-editor-tab-id]")).toHaveCount(1)
  const remaining = await page
    .locator("[data-editor-tab-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-editor-tab-id")))
  return remaining[0]!
}

test("STATE-03/04: a sibling tab starts clean and the original tab's own viewport is restored (rich mode)", async ({
  page,
}) => {
  test.setTimeout(60_000)

  await openEditorHarness(page)
  const tabAId = await closeExtraTabsDownToOne(page)

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
  const editorScrollTarget = 3000
  const windowScrollTarget = 1200
  await editorWritingArea.evaluate((element, target) => {
    element.scrollTop = target
  }, editorScrollTarget)
  await page.evaluate((target) => window.scrollTo(0, target), windowScrollTarget)
  await page.waitForTimeout(300)

  const aPre = await readScrollState(page)
  // editorScrollTop is the only axis this harness page can actually drive
  // to a non-trivial value -- the page itself never overflows (verified:
  // document.documentElement.scrollHeight === window.innerHeight here), and
  // there is no `main` element on this route, so windowScrollY/mainScrollTop
  // stay pinned near 0 regardless of the window.scrollTo() call above. The
  // per-axis comparisons below still catch a same-magnitude swap between
  // axes: if editorScrollTop's real value leaked into windowScrollY (or vice
  // versa), that field would drift away from ITS OWN near-zero baseline,
  // which expectScrollRestored asserts against individually.
  expect(aPre.editorScrollTop).toBeGreaterThan(1000)

  // Create a second, real, persisted document ("New Artifact").
  await page.getByRole("button", { name: "New Artifact" }).click()
  await expect(page.locator("[data-editor-tab-id]")).toHaveCount(2)
  const bTabIds = await page
    .locator("[data-editor-tab-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-editor-tab-id")))
  const tabBId = bTabIds.find((id) => id !== tabAId)!

  // STATE-03: B must start clean -- A's scroll must never leak into a
  // sibling tab, on any axis.
  expectScrollClean(await readScrollState(page))

  // STATE-04: switching back to A restores A's own viewport, axis by axis.
  await page.locator(`[data-editor-tab-id="${tabAId}"]`).click()
  await page.waitForTimeout(500)
  expectScrollRestored(aPre, await readScrollState(page))

  // Repeat the round trip once more: a fix that only works the first time
  // (e.g. a stale ref never reset) would pass the assertion above and fail
  // this one.
  await page.locator(`[data-editor-tab-id="${tabBId}"]`).click()
  await page.waitForTimeout(300)
  await page.locator(`[data-editor-tab-id="${tabAId}"]`).click()
  await page.waitForTimeout(500)
  expectScrollRestored(aPre, await readScrollState(page))
})

test("STATE-03/04: a sibling tab starts clean and the original tab's own viewport is restored (markdown mode)", async ({
  page,
}) => {
  test.setTimeout(60_000)

  await openEditorHarness(page)
  const tabAId = await closeExtraTabsDownToOne(page)

  await switchToMarkdown(page)
  const markdownField = await markdownTextarea(page)

  const longParagraph =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n\n"
  await markdownField.fill(longParagraph.repeat(80))

  // handleMarkdownChange debounces the markdown->rich conversion and persist
  // by MARKDOWN_SAVE_DEBOUNCE_MS (800ms): switching tabs before that fires
  // leaves the underlying (persisted) rich content stale/blank, so hydration
  // later reconstructs markdown from that stale content instead of what was
  // actually typed here -- a content-persistence gap, not a scroll-restore
  // one, but it would otherwise make this test fail for the wrong reason.
  await page.waitForTimeout(1000)

  const editorWritingArea = page.locator('[data-testid="editor-writing-area"]')
  const editorScrollTarget = 2600
  const windowScrollTarget = 900
  await editorWritingArea.evaluate((element, target) => {
    element.scrollTop = target
  }, editorScrollTarget)
  await page.evaluate((target) => window.scrollTo(0, target), windowScrollTarget)
  await page.waitForTimeout(300)

  const aPre = await readScrollState(page)
  // See the rich-mode test above: this harness route never overflows, so
  // editorScrollTop is the only axis that reaches a non-trivial value here.
  expect(aPre.editorScrollTop).toBeGreaterThan(1000)

  // Create a second, real, persisted document ("New Artifact"). It opens in
  // rich mode by default -- switching to it and back to A is the exact
  // cross-document path the markdown generation-awareness fix targets.
  await page.getByRole("button", { name: "New Artifact" }).click()
  await expect(page.locator("[data-editor-tab-id]")).toHaveCount(2)
  const bTabIds = await page
    .locator("[data-editor-tab-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-editor-tab-id")))
  const tabBId = bTabIds.find((id) => id !== tabAId)!

  expectScrollClean(await readScrollState(page))

  await page.locator(`[data-editor-tab-id="${tabAId}"]`).click()
  await expect(markdownField).toBeVisible()
  await page.waitForTimeout(500)
  expectScrollRestored(aPre, await readScrollState(page))

  await page.locator(`[data-editor-tab-id="${tabBId}"]`).click()
  await page.waitForTimeout(300)
  await page.locator(`[data-editor-tab-id="${tabAId}"]`).click()
  await expect(markdownField).toBeVisible()
  await page.waitForTimeout(500)
  expectScrollRestored(aPre, await readScrollState(page))
})
