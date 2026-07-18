import { expect, test, type Page } from "@playwright/test"
import { openEditorHarness } from "./helpers/editor"

declare global {
  interface Window {
    __voiceRecorderStarts?: number
  }
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
      readonly mimeType: string
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onerror: ((event: Event & { error?: DOMException }) => void) | null = null
      onpause: ((event: Event) => void) | null = null
      onresume: ((event: Event) => void) | null = null
      onstop: ((event: Event) => void) | null = null

      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        this.mimeType = options?.mimeType ?? "audio/webm"
      }

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
        getUserMedia: async () => ({
          getTracks: () => [{ stop() {} }],
        }),
      },
    })

    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext
    window.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder
  })
}

test("Notes voice recorder contains its layout and retries the same blob", async ({ page }) => {
  await installVoiceRecorderMock(page)

  let transcriptionAttempt = 0
  await page.route("**/api/margins/transcribe", async (route) => {
    transcriptionAttempt += 1
    await new Promise((resolve) => setTimeout(resolve, 250))

    if (transcriptionAttempt === 1) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ data: null, error: { message: "Transcription service unavailable." } }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          transcript: transcriptionAttempt === 2 ? "" : "Voice transcript restored from the same recording.",
        },
        error: null,
      }),
    })
  })

  await openEditorHarness(page)
  const editor = page.locator(".odessay-editor-content")
  await editor.click()
  await editor.type("A longer highlighted passage that wraps across two lines inside the Notes card.")
  await editor.click({ clickCount: 3 })
  await page.getByRole("button", { name: "Mark passage" }).click()

  await page.getByRole("button", { name: "Notes panel" }).click()
  const notesPanel = page.getByTestId("editor-panel-notes")
  await expect(notesPanel).toBeVisible()
  await notesPanel.getByRole("button", { name: "Record audio note" }).click({ force: true })

  const recording = notesPanel.getByTestId("voice-recorder-recording")
  await expect(recording).toBeVisible()
  const recorderStarts = await page.evaluate(() => window.__voiceRecorderStarts)
  expect(await notesPanel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  for (const label of ["Pause", "Stop", "Discard"]) {
    const button = recording.getByRole("button", { name: new RegExp(label, "i") })
    await expect(button).toBeVisible()
    const [buttonBox, panelBox] = await Promise.all([button.boundingBox(), notesPanel.boundingBox()])
    expect(buttonBox).not.toBeNull()
    expect(panelBox).not.toBeNull()
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width)
  }
  await page.screenshot({ path: "output/playwright/ode-379/recording.png" })

  await recording.getByRole("button", { name: /Stop/i }).click()
  await expect(notesPanel.getByTestId("voice-recorder-transcribing")).toBeVisible()
  await expect(notesPanel.getByRole("button", { name: /Pause/i })).toHaveCount(0)
  await page.screenshot({ path: "output/playwright/ode-379/transcribing.png" })

  const errorState = notesPanel.getByTestId("voice-recorder-error")
  await expect(errorState).toContainText("Transcription service unavailable.")
  await expect(errorState.getByRole("button", { name: "Retry" })).toBeVisible()
  await expect(errorState.getByRole("button", { name: "Discard" })).toBeVisible()
  await page.screenshot({ path: "output/playwright/ode-379/error.png" })

  await errorState.getByRole("button", { name: "Retry" }).click()
  await expect(notesPanel.getByTestId("voice-recorder-transcribing")).toBeVisible()
  await expect(errorState).toContainText("The recording does not contain enough audio to transcribe.")
  expect(await page.evaluate(() => window.__voiceRecorderStarts)).toBe(recorderStarts)

  await errorState.getByRole("button", { name: "Retry" }).click()
  await expect(notesPanel.getByTestId("voice-recorder-recording")).toHaveCount(0)
  await expect(notesPanel.getByPlaceholder("Add a note…")).toHaveValue(
    "Voice transcript restored from the same recording.",
  )
  expect(transcriptionAttempt).toBe(3)
})
