import { expect, test } from "@playwright/test"

test("reading view stays usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/perf/reading-harness")

  await expect(page.getByTestId("reading-chrome")).toBeVisible()
  await expect(page.getByTestId("reading-body-shell")).toBeVisible()
  await expect(page.getByTestId("reading-body")).toBeVisible()
  await expect(page.getByTestId("reading-body").locator("table")).toBeVisible()

  const title = page.locator("#reading-text h1")
  await expect(title).toBeVisible()
  await expect(title).toHaveCSS("font-size", "24px")

  const body = page.getByTestId("reading-body")
  await expect(body).toHaveCSS("font-size", "16px")
  const mobileLineHeight = await body.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight))
  expect(mobileLineHeight).toBeGreaterThan(28.5)
  expect(mobileLineHeight).toBeLessThan(29.5)

  await expect(page.getByLabel("Previous writing")).toBeHidden()
  await expect(page.getByLabel("Next writing")).toBeHidden()

  const shellWidth = await page.getByTestId("reading-body-shell").evaluate((element) => element.getBoundingClientRect().width)
  expect(shellWidth).toBeGreaterThan(360)

  const readingText = page.getByTestId("reading-text")
  const topbar = page.getByTestId("reading-chrome")
  const topbarTopBefore = await topbar.evaluate((element) => element.getBoundingClientRect().top)
  const scrollBefore = await readingText.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }))

  expect(scrollBefore.scrollHeight).toBeGreaterThan(scrollBefore.clientHeight)

  await readingText.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })

  const scrollAfter = await readingText.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
  }))
  const topbarTopAfter = await topbar.evaluate((element) => element.getBoundingClientRect().top)

  expect(scrollAfter.scrollTop).toBeGreaterThan(0)
  expect(scrollAfter.scrollHeight).toBe(scrollBefore.scrollHeight)
  expect(topbarTopAfter).toBeCloseTo(topbarTopBefore, 1)

  await page.getByLabel("Open margins").click()
  await expect(page.getByLabel("Close")).toBeVisible()
  await expect(page.getByTestId("reading-margin-panel")).toBeVisible()

  const panelBounds = await page.getByTestId("reading-margin-panel").evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, height: rect.height, width: rect.width }
  })

  expect(panelBounds.height).toBeGreaterThan(560)
  expect(panelBounds.height).toBeLessThan(700)
  expect(panelBounds.top).toBeGreaterThan(150)

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasOverflow).toBe(false)
})

test("reading view remains stable on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/perf/reading-harness")

  await expect(page.getByTestId("reading-chrome")).toBeVisible()
  await expect(page.getByLabel("Previous writing")).toBeHidden()
  await expect(page.getByLabel("Next writing")).toBeHidden()

  const title = page.locator("#reading-text h1")
  await expect(title).toHaveCSS("font-size", "30px")

  const body = page.getByTestId("reading-body")
  await expect(body).toHaveCSS("font-size", "17px")

  const readingText = page.getByTestId("reading-text")
  const topbar = page.getByTestId("reading-chrome")
  const topbarTopBefore = await topbar.evaluate((element) => element.getBoundingClientRect().top)
  const scrollBefore = await readingText.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }))

  expect(scrollBefore.scrollHeight).toBeGreaterThan(scrollBefore.clientHeight)

  await readingText.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })

  const scrollAfter = await readingText.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
  }))
  const topbarTopAfter = await topbar.evaluate((element) => element.getBoundingClientRect().top)

  expect(scrollAfter.scrollTop).toBeGreaterThan(0)
  expect(scrollAfter.scrollHeight).toBe(scrollBefore.scrollHeight)
  expect(topbarTopAfter).toBeCloseTo(topbarTopBefore, 1)

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasOverflow).toBe(false)
})
