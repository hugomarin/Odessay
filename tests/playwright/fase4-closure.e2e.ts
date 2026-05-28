import { test } from "@playwright/test"
import {
  assertCanonicalHarnesses,
  assertFase4AssetInventory,
  assertPreviewFixture,
  assertPublicClosureSurface,
  assertReadingHarness,
  assertSharedClosureSurface,
  assertWritePathBootstrap,
  assertWritePersistenceOnStableHarness,
  openStableWriteHarness,
  openWriteNewHarness,
} from "./helpers/fase4"

test.setTimeout(60_000)

test("fase 4 closure flow stays executable through proven harnesses", async ({ page }) => {
  await test.step("inventory proven Playwright assets before executing the closure flow", async () => {
    await assertFase4AssetInventory()
  })

  await test.step("write path bootstraps deterministically without auth discovery", async () => {
    await openWriteNewHarness(page)
    await assertWritePathBootstrap(page)
  })

  await test.step("stable write harness preserves persisted content across reload", async () => {
    await openStableWriteHarness(page)
    await assertWritePersistenceOnStableHarness(
      page,
      "Fase 4 closure text preserves write-path persistence across reload.",
    )
  })

  await test.step("preview, shared, public, and reading surfaces keep deterministic closure coverage", async () => {
    await assertPreviewFixture(page)
    await assertSharedClosureSurface(page)
    await assertPublicClosureSurface(page)
    await assertReadingHarness(page)
  })

  await test.step("canonical harness routes remain stable for write and shared entry points", async () => {
    await assertCanonicalHarnesses(page)
  })
})
