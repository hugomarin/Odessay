// @vitest-environment happy-dom

/**
 * AI-01 — Suggest title reaches the real route and provider regardless of
 * sync lifecycle.
 *
 * The internal chain is: webAIService.suggestTitle -> fetch("/api/ai/title-suggestions")
 * -> the real POST route handler (request validation, content validation,
 * prompt construction, response parsing) -> fetch(provider chatCompletionsUrl)
 * -> the external AI provider. Only that last hop is genuinely external and
 * faked here; everything between webAIService and the provider call is the
 * real, unmodified production code, connected through a single global
 * `fetch` router that dispatches by URL instead of a real HTTP server.
 *
 * `checkWritingLifecycleForRemoteAI` used to hard-block the request with
 * `INVALID_INPUT` before it ever reached this chain, whenever the writing's
 * local sync lifecycle was `local-only` or `syncing` — exactly the state of
 * every brand-new draft until its first sync completes. The route never
 * reads or needs `writingId` at all (its schema only accepts
 * currentTitle/bodyText), so the guard protected nothing server-side; it
 * only produced false negatives on real documents. The guard was added in
 * the same commit (ODE-205) as the equivalent, legitimate guard on
 * `hydrateCorrectionBlocks` (correction blocks ARE keyed server-side by
 * writingId, so there's genuinely nothing to hydrate for an unsynced
 * writing) — that one stays, and has its own control below.
 *
 * See workflow/quality/capability-integration-map.md (AI-01).
 */
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement, useState } from "react"
import { createRoot } from "react-dom/client"
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal"
import { webAIService } from "@/lib/services/web-ai-service"
import { POST as titleSuggestionsRoute } from "@/app/api/ai/title-suggestions/route"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import type { WritingLifecycle } from "@/lib/services/contracts/document-service"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("../../support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("../../support/editor-shell-doubles")).nextNavigationDouble(),
)
vi.mock("@tauri-apps/api/core", async (importOriginal) =>
  (await import("../../support/editor-shell-doubles")).tauriCoreDouble(
    await importOriginal<Record<string, unknown>>(),
  ),
)
vi.mock("@tauri-apps/api/event", async () =>
  (await import("../../support/editor-shell-doubles")).tauriEventDouble(),
)
vi.mock("@tauri-apps/plugin-dialog", async () =>
  (await import("../../support/editor-shell-doubles")).tauriDialogDouble(),
)
vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("../../support/editor-shell-doubles")).runtimeDetectionDouble(),
)

const { mountEditorShell, resetEditorShellWorld, waitFor, world } = await import(
  "../../support/editor-shell-harness"
)
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEditorSessionTab, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const BODY_TEXT = "A short body with more than enough words to satisfy the minimum content check."
const PROVIDER_CHAT_COMPLETIONS_URL = "https://api.fireworks.ai/inference/v1/chat/completions"

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

const admissionMock = vi.hoisted(() => ({
  tryAcquireAiAdmission: vi.fn(),
  releaseAiAdmission: vi.fn(),
  logAiAdmissionEvent: vi.fn(),
}))

// Deliberately kept as deterministic test boundaries, per the reviewer's
// explicit carve-out: auth/admission are not the AI-01 property (they don't
// depend on writing lifecycle at all), and the real implementations hit a
// live Supabase project (cookie/session auth, an admin-client RPC for
// admission) that cannot run inside Vitest. Everything else below —
// getAIProviderConfig, the route's own validation/prompt/parsing, and
// webAIService itself — is real and unmocked.
vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: vi.fn(async () => {
    const result = await supabaseMock.getUser()
    return { userId: result.data?.user?.id ?? null }
  }),
}))

vi.mock("@/lib/ai/admission", () => admissionMock)

const makeLocalWriting = (id: string, lifecycle: WritingLifecycle): LocalWriting => ({
  id,
  body_json: {},
  body_text: BODY_TEXT,
  status: "draft",
  visibility: "private",
  version: 1,
  sync_status: lifecycle === "server-confirmed" ? "synced" : "pending",
  lifecycle,
  created_at: "2026-09-20T00:00:00.000Z",
  updated_at: "2026-09-20T00:00:00.000Z",
  local_updated_at: Date.now(),
})

const makeProviderResponse = (title: string) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title }) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )

type ProviderBehavior = (init?: RequestInit) => Promise<Response>

const providerBehaviors: ProviderBehavior[] = []
const routeBehaviors: Array<() => Promise<Response>> = []

let routeCallCount = 0
let providerCallCount = 0
let providerResponseTitle = "Untitled"

/**
 * A single global fetch router standing in for the network: it recognizes
 * the two URLs this chain actually calls — the app's own relative API path,
 * and the real Fireworks chat-completions endpoint the real
 * getAIProviderConfig() resolves to — and dispatches accordingly. Anything
 * else throws, so a future change that starts calling some other URL fails
 * loudly instead of silently returning nothing.
 */
const fetchRouter = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString()

  if (url === "/api/ai/title-suggestions") {
    routeCallCount += 1
    const routeBehavior = routeBehaviors.shift()
    if (routeBehavior) return routeBehavior()
    const request = new Request(`https://app.odessay.com${url}`, init)
    return titleSuggestionsRoute(request)
  }

  if (url === PROVIDER_CHAT_COMPLETIONS_URL) {
    providerCallCount += 1
    const behavior = providerBehaviors.shift()
    return behavior ? behavior(init) : makeProviderResponse(providerResponseTitle)
  }

  throw new Error(`Unexpected fetch to ${url} in the AI-01 proof`)
})

beforeEach(() => {
  vi.stubGlobal("window", globalThis)
  vi.stubGlobal("fetch", fetchRouter)
  setLocalDBScope(`ai-01-${crypto.randomUUID()}`)

  process.env.FIREWORKS_API_KEY = "test-key"
  process.env.FIREWORKS_MODEL = "test-model"

  routeCallCount = 0
  providerCallCount = 0
  providerResponseTitle = "Untitled"
  providerBehaviors.length = 0
  routeBehaviors.length = 0

  supabaseMock.getUser.mockReset()
  supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
  admissionMock.tryAcquireAiAdmission.mockReset()
  admissionMock.tryAcquireAiAdmission.mockResolvedValue({ admitted: true, leaseId: "lease-1" })
  admissionMock.releaseAiAdmission.mockReset()
  admissionMock.logAiAdmissionEvent.mockReset()
})

let mountedShell: Awaited<ReturnType<typeof mountEditorShell>> | null = null

afterEach(async () => {
  if (vi.isFakeTimers()) vi.useRealTimers()
  await mountedShell?.unmount()
  mountedShell = null
  delete process.env.FIREWORKS_API_KEY
  delete process.env.FIREWORKS_MODEL
})

function buttonWithText(text: string, root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => (button.textContent ?? "").trim() === text && !button.classList.contains("sr-only"),
  )
}

async function clickButton(text: string, root: ParentNode = document) {
  const button = buttonWithText(text, root)
  expect(button, `button "${text}"`).toBeTruthy()
  await act(async () => {
    button!.click()
  })
}

async function settleMicrotasks(turns = 40) {
  await act(async () => {
    for (let index = 0; index < turns; index += 1) {
      await Promise.resolve()
    }
  })
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void
  let rejectPromise!: (reason?: unknown) => void
  let settled = false
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    get settled() {
      return settled
    },
    resolve(value: T) {
      if (settled) return
      settled = true
      resolvePromise(value)
    },
    reject(reason: unknown) {
      if (settled) return
      settled = true
      rejectPromise(reason)
    },
  }
}

type RenameTarget = { id: string; title: string; bodyText: string }

/**
 * This host keeps RenameWritingModal mounted while `open` and `writingId`
 * follow Desk's `renameTarget !== null` contract. Its two controls model the
 * real sequence: rename A, cancel, then rename B; the Suggest button itself
 * is the production modal action under test.
 */
function DeskRenameModalHarness({ writingA, writingB }: { writingA: RenameTarget; writingB: RenameTarget }) {
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setRenameTarget(writingA) }, "Rename A"),
    createElement("button", { type: "button", onClick: () => setRenameTarget(writingB) }, "Rename B"),
    createElement(RenameWritingModal, {
      open: renameTarget !== null,
      title: renameTarget?.title ?? "Untitled artifact",
      bodyText: renameTarget?.bodyText ?? "",
      writingId: renameTarget?.id,
      onOpenChange: (open) => {
        if (!open) setRenameTarget(null)
      },
      onConfirm: async () => true,
    }),
  )
}

async function mountDeskRenameModal(writingA: RenameTarget, writingB: RenameTarget) {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(DeskRenameModalHarness, { writingA, writingB }))
  })
  return async () => {
    await act(async () => root.unmount())
    container.remove()
  }
}

function makeRichText(bodyText: string): Record<string, unknown> {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }],
  }
}

async function mountWebShellForTitleSuggestion(writingId: string, title: string, bodyText: string) {
  resetEditorShellWorld()
  // Keep the existing AI-01 URL router as the one network seam: its app URL
  // branch invokes the real route and its provider branch fakes only Fireworks.
  const defaultHarnessNetwork = world.network
  world.network = (url, init) =>
    url === "/api/ai/title-suggestions" || url === PROVIDER_CHAT_COMPLETIONS_URL
      ? fetchRouter(url, init)
      : defaultHarnessNetwork(url, init)

  await localDB.writings.save({
    ...makeLocalWriting(writingId, "server-confirmed"),
    title,
    body_json: makeRichText(bodyText),
    body_text: bodyText,
  })
  await writeEditorSession({
    ...createEmptyEditorSession(),
    active_tab_id: writingId,
    tabs: [createEditorSessionTab({ id: writingId, writingId, title })],
  })

  mountedShell = await mountEditorShell({ writingId })
  await waitFor(() => (world.editor?.getText() === bodyText ? world.editor : null), {
    label: "el cuerpo real hidratado en la shell web",
    timeoutMs: 10_000,
  })
  const renameButton = await waitFor(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Rename artifact"]'),
    { label: "la acción real de renombrar de la shell" },
  )
  await act(async () => renameButton.click())
  await waitFor(() => buttonWithText("Suggest"), { label: "el botón real Suggest del modal" })
}

function visibleSuggestionError() {
  const dialog = document.querySelector('[role="dialog"]') ?? document
  return Array.from(dialog.querySelectorAll("p.text-destructive")).find((paragraph) =>
    (paragraph.textContent ?? "").trim(),
  )
}

describe("AI-01 — suggestTitle reaches the real route and provider regardless of lifecycle", () => {
  it.each<WritingLifecycle>(["local-only", "syncing", "server-confirmed"])(
    "for a %s writing: real route runs, real provider is called, suggestion returns",
    async (lifecycle) => {
      await localDB.writings.save(makeLocalWriting("writing-1", lifecycle))
      providerResponseTitle = `Title for ${lifecycle}`

      const result = await webAIService.suggestTitle({
        currentTitle: "Untitled artifact",
        bodyText: BODY_TEXT,
        writingId: "writing-1",
      })

      expect(routeCallCount).toBe(1)
      expect(providerCallCount).toBe(1)
      expect(admissionMock.tryAcquireAiAdmission).toHaveBeenCalledWith({
        accountId: "user-1",
        routeKey: "title-suggestions",
      })
      expect(admissionMock.releaseAiAdmission).toHaveBeenCalledWith("lease-1")
      expect(result.error).toBeNull()
      expect(result.data?.title).toBe(`Title for ${lifecycle}`)
    },
  )

  it("still reaches the real route and provider when no writingId is provided at all (new, never-saved draft)", async () => {
    providerResponseTitle = "Title for brand-new draft"

    const result = await webAIService.suggestTitle({
      currentTitle: "Untitled artifact",
      bodyText: BODY_TEXT,
    })

    expect(routeCallCount).toBe(1)
    expect(providerCallCount).toBe(1)
    expect(result.error).toBeNull()
    expect(result.data?.title).toBe("Title for brand-new draft")
  })
})

describe("ODE-620 — a stale A suggestion never enters Desk's reused modal for B", () => {
  it.each(["success", "error"] as const)(
    "discards A's late %s response after Desk closes A and opens B",
    async (lateResult) => {
      const writingA = { id: `writing-a-${crypto.randomUUID()}`, title: "Title A", bodyText: BODY_TEXT }
      const writingB = { id: `writing-b-${crypto.randomUUID()}`, title: "Title B", bodyText: `${BODY_TEXT} B.` }
      await localDB.writings.save(makeLocalWriting(writingA.id, "server-confirmed"))
      await localDB.writings.save(makeLocalWriting(writingB.id, "server-confirmed"))

      const unmount = await mountDeskRenameModal(writingA, writingB)
      const lateA = deferred<Response>()
      const responseB = deferred<Response>()

      try {
        providerResponseTitle = "Positive control — A suggestion"
        await clickButton("Rename A")
        await clickButton("Suggest")
        await waitFor(() => (providerCallCount === 1 ? providerCallCount : null), {
          label: "la petición real de A llegó al proveedor fakeado",
        })
        await waitFor(() => document.body.textContent?.includes("Positive control — A suggestion"), {
          label: "control positivo: la sugerencia sí aparece para A",
        })
        expect(document.body.textContent).toContain("Positive control — A suggestion")
        await clickButton("Dismiss")

        providerBehaviors.push(() => lateA.promise, () => responseB.promise)
        await clickButton("Suggest")
        await waitFor(() => (providerCallCount === 2 ? providerCallCount : null), {
          label: "la segunda petición de A quedó en vuelo",
        })
        await clickButton("Cancel")
        await waitFor(() => (buttonWithText("Suggest") ? null : true), {
          label: "Desk cerró el modal sin desmontar su instancia",
        })

        await clickButton("Rename B")
        await waitFor(() => buttonWithText("Suggest"), { label: "el mismo modal reabrió para B" })
        await clickButton("Suggest")
        await waitFor(() => (providerCallCount === 3 ? providerCallCount : null), {
          label: "la petición de B quedó en vuelo",
        })
        expect(buttonWithText("Suggesting"), "B conserva su estado de carga").toBeTruthy()

        await act(async () => {
          if (lateResult === "success") {
            lateA.resolve(makeProviderResponse("Stale result from A"))
          } else {
            lateA.reject(new Error("late provider network failure from A"))
          }
          for (let index = 0; index < 40; index += 1) await Promise.resolve()
        })

        expect(buttonWithText("Suggesting"), "la respuesta de A no debe limpiar el loading de B").toBeTruthy()
        expect(document.body.textContent).not.toContain("Stale result from A")
        expect(visibleSuggestionError(), "el error de A no debe aparecer en B").toBeFalsy()

        await act(async () => {
          responseB.resolve(makeProviderResponse("Suggestion belongs to B"))
          for (let index = 0; index < 40; index += 1) await Promise.resolve()
        })
        await waitFor(() => document.body.textContent?.includes("Suggestion belongs to B"), {
          label: "B recibe su propia sugerencia después de asentarse su respuesta",
        })
        expect(document.body.textContent).toContain("Suggestion belongs to B")
      } finally {
        if (!lateA.settled) lateA.resolve(makeProviderResponse("Cleanup A"))
        if (!responseB.settled) responseB.resolve(makeProviderResponse("Cleanup B"))
        await settleMicrotasks()
        await unmount()
      }
    },
  )
})

describe("ODE-620 — web shell surfaces provider failures and can retry", () => {
  it.fails.each(["timeout", "provider 5xx", "provider network error", "route network failure"] as const)(
    "shows the settled %s error with the approved copy, preserves the writing, and retries through the real route",
    async (failureMode) => {
      const writingId = `writing-error-${crypto.randomUUID()}`
      const title = "Title stays until accepted"
      const bodyText = `Web shell body for ${failureMode}; ${BODY_TEXT}`
      await mountWebShellForTitleSuggestion(writingId, title, bodyText)
      const before = await localDB.writings.get(writingId)
      expect(before).toBeTruthy()

      let observedAbortSignal: AbortSignal | null = null
      if (failureMode === "timeout") {
        providerBehaviors.push(
          (init) =>
            new Promise<Response>((_resolve, reject) => {
              observedAbortSignal = init?.signal ?? null
              const signal = init?.signal
              if (!signal) {
                reject(new Error("The real route omitted its provider AbortSignal"))
                return
              }
              const abort = () => {
                const error = new Error("provider aborted after route timeout")
                error.name = "AbortError"
                reject(error)
              }
              if (signal.aborted) abort()
              else signal.addEventListener("abort", abort, { once: true })
            }),
        )
        // The route's 45s deadline is the only timer under test.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      } else if (failureMode === "provider 5xx") {
        providerBehaviors.push(async () => new Response("temporary provider outage", { status: 503 }))
      } else if (failureMode === "provider network error") {
        providerBehaviors.push(async () => {
          throw new TypeError("provider network disconnected")
        })
      } else {
        // The app's own route never answers: the fetch to
        // /api/ai/title-suggestions rejects at the network boundary, so
        // webAIService turns the technical message into an error envelope
        // before the modal ever sees it.
        routeBehaviors.push(async () => {
          throw new TypeError("Failed to fetch")
        })
      }

      await clickButton("Suggest")
      if (failureMode === "timeout") {
        await settleMicrotasks()
        expect(providerCallCount).toBe(1)
        expect(observedAbortSignal).toBeTruthy()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(45_000)
          for (let index = 0; index < 40; index += 1) await Promise.resolve()
        })
        vi.useRealTimers()
      } else if (failureMode !== "route network failure") {
        await waitFor(() => (providerCallCount === 1 ? providerCallCount : null), {
          label: `la llamada real al proveedor con ${failureMode}`,
        })
      }

      await waitFor(() => (visibleSuggestionError() && buttonWithText("Suggest") ? true : null), {
        label: `error visible ${failureMode} después del evento de respuesta de la ruta`,
      })
      expect(routeCallCount, "la petición atravesó el POST real de AI-01").toBe(1)
      expect(providerCallCount, "el proveedor fakeado recibió la petición real de la ruta").toBe(
        failureMode === "route network failure" ? 0 : 1,
      )
      expect(visibleSuggestionError()?.textContent?.trim()).toBe("Could not suggest a name. Try again.")
      expect(buttonWithText("Suggest")?.disabled).toBe(false)
      expect(document.querySelector<HTMLInputElement>('input[aria-label="Artifact name"]')?.value).toBe(title)
      expect(mountedShell?.editor().getText()).toBe(bodyText)

      const afterFailure = await localDB.writings.get(writingId)
      expect(afterFailure?.title).toBe(before?.title)
      expect(afterFailure?.body_text).toBe(before?.body_text)
      expect(afterFailure?.body_json).toEqual(before?.body_json)

      providerResponseTitle = "Suggestion after retry"
      await clickButton("Suggest")
      await waitFor(() =>
        document.body.textContent?.includes("Suggestion after retry") ? document.body.textContent : null,
      {
        label: "la sugerencia aparece en el modal tras reintentar con el proveedor sano",
      })
      expect(routeCallCount).toBe(2)
      expect(providerCallCount).toBe(failureMode === "route network failure" ? 1 : 2)
      expect(visibleSuggestionError()).toBeFalsy()
      expect(document.querySelector<HTMLInputElement>('input[aria-label="Artifact name"]')?.value).toBe(title)
      const afterRetry = await localDB.writings.get(writingId)
      expect(afterRetry?.title).toBe(before?.title)
      expect(afterRetry?.body_text).toBe(before?.body_text)
      expect(afterRetry?.body_json).toEqual(before?.body_json)
      expect(mountedShell?.editor().getText()).toBe(bodyText)
    },
    30_000,
  )
})

describe("AI-01 — hydrateCorrectionBlocks keeps its legitimate lifecycle guard", () => {
  it.each<WritingLifecycle>(["local-only", "syncing"])(
    "skips the network for a %s writing (nothing exists server-side to hydrate yet)",
    async (lifecycle) => {
      await localDB.writings.save(makeLocalWriting("writing-1", lifecycle))
      const fetchSpy = vi.fn()
      vi.stubGlobal("fetch", fetchSpy)

      const result = await webAIService.hydrateCorrectionBlocks("writing-1")

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.error).toBeNull()
      expect(result.data).toEqual([])
    },
  )

  it("calls the network for a server-confirmed writing", async () => {
    await localDB.writings.save(makeLocalWriting("writing-1", "server-confirmed"))
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ data: [], error: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchSpy)

    const result = await webAIService.hydrateCorrectionBlocks("writing-1")

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result.error).toBeNull()
  })
})
