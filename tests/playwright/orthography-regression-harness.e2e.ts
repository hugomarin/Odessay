import { expect, test, type Page } from "@playwright/test"
import type { PublicationReviewRequest } from "@/lib/services/contracts/ai-service"
import {
  buildOrthographyRegressionCorrections,
  ORTHOGRAPHY_REGRESSION_WRITING_ID,
} from "@/lib/testing/orthography-regression-fixture"

type PersistRequestBody = {
  writingId: string
  deletedBlockIds?: string[]
  block?: {
    id: string
    writing_id: string
    block_id: string
    block_hash: string
    suggestions: Array<{ original_text: string; replacement_text: string }>
  }
}

type HarnessWritingSnapshot = {
  body_text: string
} | null

type HarnessCorrectionBlockSnapshot = Array<{
  blockHash: string
  suggestions: Array<{
    original_text: string
    status: string
  }>
}>

const waitForCorrectionPanelCount = async (page: Page, count: number) => {
  await expect.poll(async () => {
    const panel = page.getByTestId("editor-panel-corrections")
    if (!(await panel.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Corrections" }).click()
    }

    return page.locator("#editor-panel-corrections li").count()
  }, { timeout: 15_000 }).toBe(count)
}

test("orthography regression harness preserves apply, invalidation, and persisted state across reload", async ({
  page,
}) => {
  const reviewBodies: PublicationReviewRequest[] = []
  const persistBodies: PersistRequestBody[] = []

  await page.route("**/api/corrections/hydrate?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        error: null,
      }),
    })
  })

  await page.route("**/api/corrections/persist", async (route) => {
    const body = route.request().postDataJSON() as PersistRequestBody
    persistBodies.push(body)

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          persistedId: body.block?.id ?? null,
          deletedIds: body.deletedBlockIds ?? [],
          syncedAt: "2026-07-01T21:30:00.000Z",
        },
        error: null,
      }),
    })
  })

  await page.route("**/api/ai/publication-review", async (route) => {
    const body = route.request().postDataJSON() as PublicationReviewRequest
    reviewBodies.push(body)
    const corrections = buildOrthographyRegressionCorrections(body.correctionBlock.id, body.correctionBlock.text)

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          summary: corrections.length > 0 ? "Orthography regression fixture corrections." : "",
          language: "es",
          corrections,
          uncertain: [],
          promptTokens: 64,
          completionTokens: 24,
        },
        error: null,
      }),
    })
  })

  await page.route("**/api/writings/*", async (route) => {
    const request = route.request()

    if (request.method() !== "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: null, error: null }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: null,
        error: null,
      }),
    })
  })

  await page.goto("/perf/orthography-harness?reset=1")
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()
  await page.evaluate(() => {
    if (window.location.search.includes("reset=1")) {
      window.history.replaceState(null, "", window.location.pathname)
    }
  })

  await waitForCorrectionPanelCount(page, 9)

  const correctionsPanel = page.getByTestId("editor-panel-corrections")
  await expect(correctionsPanel).toContainText("funcioando")
  await expect(correctionsPanel).toContainText("aplicació")
  await expect(correctionsPanel).toContainText("paralabras")
  await expect(correctionsPanel).toContainText("aprrafo")
  await expect(correctionsPanel).toContainText("mejro")
  await expect(correctionsPanel).toContainText("Solo asi")
  await expect(correctionsPanel).toContainText("Tendremos una buen producto")
  await expect(correctionsPanel).toContainText("Por ejemplo cuando")

  await expect(page.locator(".pub-suggestion-pending", { hasText: "funcioando" })).toHaveCount(1)
  await expect(page.locator(".pub-suggestion-pending", { hasText: "Solo asi" })).toHaveCount(1)

  const funcioandoRow = correctionsPanel.locator("li", { hasText: "funcioando" })
  await funcioandoRow.getByRole("button", { name: "Accept" }).click()
  await expect(correctionsPanel).not.toContainText("funcioando")
  await expect(correctionsPanel).toContainText("aplicació")
  await expect(page.locator(".odessay-editor-content")).toContainText("funcionando")
  await expect(page.locator(".odessay-editor-content")).toContainText("aplicació de escritorio creo")
  await waitForCorrectionPanelCount(page, 8)

  const punctuationRow = correctionsPanel.locator("li", { hasText: "escritorio creo" })
  await punctuationRow.getByRole("button", { name: "Accept" }).click()
  await expect(correctionsPanel).not.toContainText("escritorio creo")
  await expect(page.locator(".odessay-editor-content")).toContainText("aplicació de escritorio. Creo que")
  await expect(page.locator(".odessay-editor-content")).not.toContainText("deescritorio. Creoo")
  await waitForCorrectionPanelCount(page, 7)

  const mejroParagraph = page.locator(".odessay-editor-content p", {
    hasText: "Esto me permite evaluar una mejro experiencia de corrección.",
  })
  await expect(mejroParagraph).toBeVisible()
  await mejroParagraph.click()
  await page.evaluate(() => {
    const paragraph = Array.from(document.querySelectorAll(".odessay-editor-content p")).find((candidate) =>
      candidate.textContent?.includes("mejro"),
    )
    if (!paragraph) {
      throw new Error("Could not locate the mejro paragraph.")
    }

    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    let textNode: Text | null = null

    while (walker.nextNode()) {
      const candidate = walker.currentNode
      if (candidate.textContent?.includes("mejro")) {
        textNode = candidate as Text
        break
      }
    }

    if (!textNode) {
      throw new Error("Could not select the mejro text node.")
    }

    const text = textNode.textContent ?? ""
    const start = text.indexOf("mejro")
    if (start < 0) {
      throw new Error("Could not find mejro within the selected text node.")
    }

    const range = document.createRange()
    range.setStart(textNode, start)
    range.setEnd(textNode, start + "mejro".length)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  await page.keyboard.type("mejor")

  await expect(correctionsPanel).not.toContainText("mejro")
  await expect(page.locator(".odessay-editor-content")).toContainText(
    "Esto me permite evaluar una mejor experiencia de corrección.",
  )
  await waitForCorrectionPanelCount(page, 6)
  await expect
    .poll(async () => {
      const writing = await page.evaluate(async () => {
        return (window as typeof window & {
          __ODE_ORTHOGRAPHY_HARNESS__?: { readWriting: () => Promise<HarnessWritingSnapshot> }
        }).__ODE_ORTHOGRAPHY_HARNESS__?.readWriting()
      })

      return writing?.body_text ?? ""
    }, { timeout: 15_000 })
    .toContain("Esto me permite evaluar una mejor experiencia de corrección.")

  await page.reload()
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()
  await page.getByRole("button", { name: "Corrections" }).click()
  await waitForCorrectionPanelCount(page, 3)
  await expect(correctionsPanel).not.toContainText("funcioando")
  await expect(correctionsPanel).not.toContainText("escritorio creo")
  await expect(correctionsPanel).not.toContainText("mejro")
  await expect(correctionsPanel).toContainText("aprrafo")
  await expect(correctionsPanel).toContainText("Solo asi")
  await expect(correctionsPanel).toContainText("Tendremos una buen producto")
  await expect(page.locator(".odessay-editor-content")).toContainText("funcionando")
  await expect(page.locator(".odessay-editor-content")).toContainText("aplicació de escritorio. Creo que")
  await expect(page.locator(".odessay-editor-content")).toContainText(
    "Esto me permite evaluar una mejor experiencia de corrección.",
  )

  expect(reviewBodies).toHaveLength(0)
  expect(persistBodies.length).toBeGreaterThan(0)
  expect(
    persistBodies.some(
      (body) =>
        (body.block?.suggestions.length ?? 0) > 0 && (body.deletedBlockIds?.length ?? 0) > 0,
    ),
  ).toBe(true)
  expect(persistBodies.some((body) => (body.deletedBlockIds?.length ?? 0) > 0)).toBe(true)
})
