import { mkdir } from "node:fs/promises"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { markdownTextarea, openEditorHarness, switchToMarkdown, switchToRich } from "./helpers/editor"

declare global {
  interface Window {
    __voiceRecorderStarts?: number
  }
}

const EVIDENCE_DIR = process.env.ODE385_EVIDENCE_DIR

async function screenshot(page: Page, filename: string) {
  if (!EVIDENCE_DIR) return
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: `${EVIDENCE_DIR}/${filename}`, fullPage: false })
}

async function installVoiceRecorderMock(page: Page) {
  await page.addInitScript(() => {
    class FakeAnalyser {
      fftSize = 2048
      smoothingTimeConstant = 0
      disconnect() {}
      getByteTimeDomainData(samples: Uint8Array) {
        samples.fill(148)
      }
    }

    class FakeAudioContext {
      createAnalyser() {
        return new FakeAnalyser()
      }
      createMediaStreamSource() {
        return { connect() {} }
      }
      close() {
        return Promise.resolve()
      }
    }

    class FakeMediaRecorder {
      static isTypeSupported(type: string) {
        return type.startsWith("audio/webm")
      }

      state: RecordingState = "inactive"
      readonly mimeType = "audio/webm"
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onpause: ((event: Event) => void) | null = null
      onresume: ((event: Event) => void) | null = null
      onstop: ((event: Event) => void) | null = null

      start() {
        this.state = "recording"
        window.__voiceRecorderStarts = (window.__voiceRecorderStarts ?? 0) + 1
      }
      pause() {
        this.state = "paused"
        this.onpause?.(new Event("pause"))
      }
      resume() {
        this.state = "recording"
        this.onresume?.(new Event("resume"))
      }
      stop() {
        if (this.state === "inactive") return
        this.state = "inactive"
        // Emit audio so the bubble reaches the transcription path with a real
        // blob — the same shape the Notes panel mock produces (ODE-409).
        window.setTimeout(() => {
          const data = new Blob(["voice-bytes"], { type: this.mimeType })
          this.ondataavailable?.({ data } as BlobEvent)
          this.onstop?.(new Event("stop"))
        }, 20)
      }
    }

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    })
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext
    window.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder
  })
}

async function expectInsideViewport(locator: Locator, page: Page) {
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (!viewport) return

  // Repositioning lands on the next animation frame, so poll for the settled
  // geometry instead of measuring a frame mid-flight.
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox()
        if (!box) return null
        return {
          left: box.x >= 8,
          top: box.y >= 54,
          right: box.x + box.width <= viewport.width - 8,
          bottom: box.y + box.height <= viewport.height - 8,
        }
      },
      { timeout: 5_000 },
    )
    .toEqual({ left: true, top: true, right: true, bottom: true })
}

async function selectEdgeWord(paragraph: Locator, edge: "left" | "right") {
  await paragraph.evaluate((element, requestedEdge) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const candidates: Array<{ node: Text; start: number; end: number; center: number }> = []

    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const text = node.textContent ?? ""
      for (const match of text.matchAll(/\S+/g)) {
        const start = match.index
        const end = start + match[0].length
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, end)
        const rect = range.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          candidates.push({ node, start, end, center: rect.left + rect.width / 2 })
        }
      }
    }

    candidates.sort((a, b) => a.center - b.center)
    const target = requestedEdge === "left" ? candidates[0] : candidates.at(-1)
    if (!target) throw new Error("No visible word available for selection.")

    const range = document.createRange()
    range.setStart(target.node, target.start)
    range.setEnd(target.node, target.end)
    const selection = window.getSelection()
    if (!selection) throw new Error("Window selection is unavailable.")
    selection.removeAllRanges()
    selection.addRange(range)
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  }, edge)
}

test.describe("floating selection overlays stay inside the viewport", () => {
  test.describe.configure({ timeout: 90_000 })
  test.use({ viewport: { width: 760, height: 360 } })

  test("editor flips the annotation bubble above a selection near the bottom", async ({ page }) => {
    await installVoiceRecorderMock(page)
    await page.setViewportSize({ width: 1100, height: 360 })
    await openEditorHarness(page)
    await switchToMarkdown(page)
    const markdown = await markdownTextarea(page)
    await markdown.fill(Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1} ends here.`).join("\n\n"))
    await switchToRich(page)

    const lastParagraph = page.locator(".odessay-editor-content p").last()
    await lastParagraph.evaluate((element) => element.scrollIntoView({ block: "end" }))
    await lastParagraph.click()
    await page.keyboard.press("End")
    await page.keyboard.press("Shift+ControlOrMeta+ArrowLeft")

    const popup = page.getByTestId("selection-popup")
    await expect(popup).toBeVisible()
    await expectInsideViewport(popup, page)
    await popup.getByRole("button", { name: "Annotate passage" }).click()

    const bubble = page.getByTestId("annotation-bubble")
    await expect(bubble).toBeVisible()
    await expect(bubble).toHaveAttribute("data-placement", "above")
    await expectInsideViewport(bubble, page)
    await screenshot(page, "editor-bottom-flip.png")
    await bubble.getByRole("button", { name: "Record a voice note" }).click()
    await expect(bubble.getByRole("button", { name: "Pause recording" })).toBeVisible()
    await expectInsideViewport(bubble, page)
    await screenshot(page, "editor-bottom-voice-mode.png")
  })

  test("reading bubble flips at the bottom and clamps at both horizontal edges", async ({ page }) => {
    await installVoiceRecorderMock(page)
    await page.goto("/perf/reading-harness")
    const paragraphs = page.locator("#reading-text .prose-odessay p")
    const lastParagraph = paragraphs.last()
    await lastParagraph.evaluate((element) => element.scrollIntoView({ block: "end" }))
    await selectEdgeWord(lastParagraph, "right")

    const popup = page.getByTestId("selection-popup")
    await expect(popup).toBeVisible()
    await popup.getByRole("button", { name: "Annotate passage" }).click()
    const bubble = page.getByTestId("annotation-bubble")
    await expect(bubble).toBeVisible()
    await expect(bubble).toHaveAttribute("data-placement", "above")
    await expectInsideViewport(bubble, page)
    await screenshot(page, "reading-bottom-right-clamp.png")

    await bubble.getByRole("button", { name: "Record a voice note" }).click()
    await expect(bubble.getByRole("button", { name: "Pause recording" })).toBeVisible()
    await expectInsideViewport(bubble, page)
    await screenshot(page, "reading-bottom-voice-mode.png")
    await bubble.getByRole("button", { name: "Discard recording" }).click()

    await page.getByRole("button", { name: "Cancel" }).click()
    const firstParagraph = paragraphs.first()
    await firstParagraph.evaluate((element) => element.scrollIntoView({ block: "start" }))
    await selectEdgeWord(firstParagraph, "left")
    await expect(popup).toBeVisible()
    await popup.getByRole("button", { name: "Annotate passage" }).click()
    await expect(bubble).toBeVisible()
    await expectInsideViewport(bubble, page)
    const box = await bubble.boundingBox()
    expect(box?.x).toBe(8)
    await screenshot(page, "reading-left-clamp.png")
  })
})

// ─── ODE-409 ────────────────────────────────────────────────────────────────
// ODE-385 made the overlays follow the viewport. Repositioning must never be
// mistaken for opening a new annotation: the draft, the recording and the blob
// belong to the session, not to the geometry.

const LONG_NOTE = `${"Una nota larga que el escritor no quiere perder. ".repeat(24)}\nSegunda línea de la nota.`

async function openAnnotationBubbleInEditor(page: Page, { seed = true } = {}) {
  if (seed) {
    await openEditorHarness(page)
    await switchToMarkdown(page)
    const markdown = await markdownTextarea(page)
    await markdown.fill(
      Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1} ends here with enough words to wrap.`).join("\n\n"),
    )
    await switchToRich(page)
  }

  const lastParagraph = page.locator(".odessay-editor-content p").last()
  await lastParagraph.evaluate((element) => element.scrollIntoView({ block: "end" }))
  await lastParagraph.click()
  await page.keyboard.press("End")
  await page.keyboard.press("Shift+ControlOrMeta+ArrowLeft")

  const popup = page.getByTestId("selection-popup")
  await expect(popup).toBeVisible()
  await popup.getByRole("button", { name: "Annotate passage" }).click()

  const bubble = page.getByTestId("annotation-bubble")
  await expect(bubble).toBeVisible()
  return bubble
}

/**
 * Scroll the document and wait until the bubble has actually been repositioned.
 * Asserting the move keeps these tests from silently going vacuous: a draft that
 * survives a reposition that never happened proves nothing.
 */
async function scrollAndExpectBubbleToMove(page: Page, bubble: Locator, distance: number) {
  const before = await bubble.boundingBox()
  expect(before).not.toBeNull()

  const start = await page.evaluate(() => window.scrollY)
  // Scroll toward whichever end has room, so the anchor always moves.
  await page.evaluate(
    ({ amount, from }) => window.scrollTo(0, from >= amount ? from - amount : from + amount),
    { amount: distance, from: start },
  )
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
    .not.toBe(start)

  await expect
    .poll(async () => (await bubble.boundingBox())?.y, { timeout: 5_000 })
    .not.toBe(before?.y)
}

test.describe("an open annotation draft survives repositioning", () => {
  test.describe.configure({ timeout: 90_000 })
  test.use({ viewport: { width: 1100, height: 420 } })

  test("scroll, resize and flip preserve text, focus and cursor", async ({ page }) => {
    await installVoiceRecorderMock(page)
    const bubble = await openAnnotationBubbleInEditor(page)

    const draft = bubble.getByRole("textbox", { name: "Annotation text" })
    await draft.fill(LONG_NOTE)
    expect(LONG_NOTE.length).toBeGreaterThan(1_000)
    await expect(draft).toHaveValue(LONG_NOTE)

    // Park the caret mid-note so we can prove it is not reset either.
    const caret = 500
    await draft.evaluate((element, offset) => {
      const textarea = element as HTMLTextAreaElement
      textarea.setSelectionRange(offset, offset)
    }, caret)

    // 1. Internal scroll of the textarea — the capture-phase listener that
    //    ODE-385 added reaches this event even though nothing moved.
    await draft.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(draft).toHaveValue(LONG_NOTE)

    // 2. Scroll the document — the bubble genuinely has to move.
    await scrollAndExpectBubbleToMove(page, bubble, 30)
    await expect(draft).toHaveValue(LONG_NOTE)
    await expectInsideViewport(bubble, page)

    await scrollAndExpectBubbleToMove(page, bubble, 140)
    await expect(draft).toHaveValue(LONG_NOTE)
    await expectInsideViewport(bubble, page)

    // 3. Resize, then force a flip by shrinking the viewport.
    await page.setViewportSize({ width: 900, height: 420 })
    await expect(draft).toHaveValue(LONG_NOTE)
    await page.setViewportSize({ width: 900, height: 260 })
    await expect(draft).toHaveValue(LONG_NOTE)
    await expectInsideViewport(bubble, page)
    await screenshot(page, "ode409-draft-after-flip.png")

    // Focus and caret both belong to the session, not to the geometry.
    expect(
      await draft.evaluate((element) => document.activeElement === element),
    ).toBe(true)
    expect(
      await draft.evaluate((element) => (element as HTMLTextAreaElement).selectionStart),
    ).toBe(caret)

    // Cancel discards the session explicitly; the next one starts empty.
    await bubble.getByRole("button", { name: "Cancel" }).click()
    await expect(bubble).toBeHidden()

    await page.setViewportSize({ width: 1100, height: 420 })
    const reopened = await openAnnotationBubbleInEditor(page, { seed: false })
    await expect(reopened.getByRole("textbox", { name: "Annotation text" })).toHaveValue("")
  })

  test("a recording survives repositioning and Retry reuses the same blob", async ({ page }) => {
    await installVoiceRecorderMock(page)

    let transcriptionAttempts = 0
    await page.route("**/api/margins/transcribe", async (route) => {
      transcriptionAttempts += 1
      if (transcriptionAttempts === 1) {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ data: null, error: null }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { transcript: "Transcript recovered from the same recording." },
          error: null,
        }),
      })
    })

    const bubble = await openAnnotationBubbleInEditor(page)
    await bubble.getByRole("button", { name: "Record a voice note" }).click()
    await expect(bubble.getByRole("button", { name: "Pause recording" })).toBeVisible()
    const startsAfterRecording = await page.evaluate(() => window.__voiceRecorderStarts)

    // Scroll and resize while recording — the session must not restart.
    await scrollAndExpectBubbleToMove(page, bubble, 60)
    await page.setViewportSize({ width: 900, height: 320 })
    await expect(bubble.getByRole("button", { name: "Pause recording" })).toBeVisible()
    await expectInsideViewport(bubble, page)
    expect(await page.evaluate(() => window.__voiceRecorderStarts)).toBe(startsAfterRecording)

    await bubble.getByRole("button", { name: "Stop recording" }).click()

    // The failure is actionable and keeps the recording available.
    const failure = bubble.getByTestId("voice-recorder-error")
    await expect(failure).toBeVisible()
    await expect(failure).not.toContainText("Load failed")
    await expect(failure.getByRole("button", { name: "Retry" })).toBeVisible()
    await screenshot(page, "ode409-transcription-failure.png")

    // Repositioning after the failure must not re-fire the request either.
    await page.setViewportSize({ width: 900, height: 420 })
    await scrollAndExpectBubbleToMove(page, bubble, 40)
    await expect(failure.getByRole("button", { name: "Retry" })).toBeVisible()
    expect(transcriptionAttempts).toBe(1)

    await failure.getByRole("button", { name: "Retry" }).click()
    await expect(bubble.getByRole("textbox", { name: "Annotation text" })).toHaveValue(
      "Transcript recovered from the same recording.",
    )
    // Exactly one request per attempt — repositioning never duplicated one.
    expect(transcriptionAttempts).toBe(2)
    expect(await page.evaluate(() => window.__voiceRecorderStarts)).toBe(startsAfterRecording)
    await screenshot(page, "ode409-transcription-retry.png")
  })
})
