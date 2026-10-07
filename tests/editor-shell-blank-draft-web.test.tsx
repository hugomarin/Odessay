/**
 * @vitest-environment happy-dom
 *
 * ODE-626 — web drafts become durable only after real content or an explicit
 * title. The positive control keeps this absence proof honest: the same real
 * shell path must still create a local row and queue an upsert for content.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("./support/editor-shell-doubles")).nextNavigationDouble(),
)
vi.mock("@tauri-apps/api/event", async () =>
  (await import("./support/editor-shell-doubles")).tauriEventDouble(),
)
vi.mock("@tauri-apps/plugin-dialog", async () =>
  (await import("./support/editor-shell-doubles")).tauriDialogDouble(),
)
vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("./support/editor-shell-doubles")).runtimeDetectionDouble(),
)
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("./support/editor-shell-doubles")).aiServiceDouble(),
)
vi.mock("@/lib/editor/persistence-coordinator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editor/persistence-coordinator")>()
  const { recordPersistenceCoordinator } = await import("./support/persistence-coordinator-capture")
  return {
    ...actual,
    createPersistenceCoordinator: (...args: Parameters<typeof actual.createPersistenceCoordinator>) => {
      const coordinator = actual.createPersistenceCoordinator(...args)
      recordPersistenceCoordinator(coordinator)
      return coordinator
    },
  }
})

const {
  advance,
  capturePersistenceCoordinators,
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForHydrationReady,
} = await import("./support/editor-shell-harness")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { localDB } = await import("@/lib/local-db")

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let coordinatorCapture: ReturnType<typeof capturePersistenceCoordinators> | null = null
const TEST_TIMEOUT_MS = 60_000
const EVENTUALLY_TIMEOUT_MS = TEST_TIMEOUT_MS - 1_000
const EPHEMERAL_IDENTITY_TIMEOUT_MS = 15_000

beforeEach(async () => {
  resetEditorShellWorld()
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
  coordinatorCapture?.stop()
  coordinatorCapture = null
})

async function mountLoadedWebShell() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "web editor session loaded" })
  await flush(3)
  return mounted
}

async function eventually(read: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + EVENTUALLY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await read()) return
    await advance(100)
  }
  throw new Error(`Timed out after ${EVENTUALLY_TIMEOUT_MS}ms waiting for ${label}`)
}

describe("ODE-626 — blank web draft persistence", () => {
  it("keeps empty drafts ephemeral and materializes on real content", async () => {
    const firstMarker = "ODE626-WEB-POSITIVE-CONTROL"
    const firstBeforeIds = new Set((await localDB.writings.getAll()).map((writing) => writing.id))
    await mountLoadedWebShell()

    await typeInEditor(firstMarker)
    await eventually(
      async () =>
        (await localDB.writings.getAll()).some(
          (writing) => !firstBeforeIds.has(writing.id) && writing.body_text.includes(firstMarker),
        ),
      "a durable row for real content",
    )

    const firstCreated = (await localDB.writings.getAll()).filter(
      (writing) => !firstBeforeIds.has(writing.id) && writing.body_text.includes(firstMarker),
    )
    expect(firstCreated).toHaveLength(1)
    await eventually(
      async () => {
        const mutation = await localDB.syncQueue.getCurrentForWriting(firstCreated[0]!.id)
        return mutation?.entity_kind === "writing" && mutation.operation === "upsert"
      },
      "an upsert for real content",
    )

    await mounted!.unmount()
    mounted = null
    resetEditorShellWorld()
    await writeEditorSession(createEmptyEditorSession())

    const beforeBlankDraftIds = new Set((await localDB.writings.getAll()).map((writing) => writing.id))

    coordinatorCapture = capturePersistenceCoordinators()
    await mountLoadedWebShell()
    await waitForHydrationReady("blank draft hydration ready")
    const initialDraft = await waitFor(
      () => {
        const tab = getEditorSessionState().session.tabs.find((candidate) => candidate.writing_id === null)
        return tab?.draft_writing_id ?? null
      },
      { label: "identidad efímera del borrador inicial", timeoutMs: EPHEMERAL_IDENTITY_TIMEOUT_MS },
    )
    expect(await coordinatorCapture.settle(), "blank-draft persistence settles").toBe(true)

    expect(
      (await localDB.writings.getAll()).filter((writing) => !beforeBlankDraftIds.has(writing.id)),
      "mounting /write creates no durable writing row",
    ).toEqual([])

    const initialDraftId = initialDraft
    expect(await localDB.writings.get(initialDraftId), "mounting /write creates no durable row").toBeNull()
    expect(await localDB.syncQueue.getCurrentForWriting(initialDraftId), "mounting /write queues no upsert").toBeNull()

    await clickNewArtifact(mounted!.container)
    expect(mounted!.editor().getText()).toBe("")

    const newDraftId = await waitFor(
      () => {
        const tab = getEditorSessionState().session.tabs.find((candidate) => candidate.writing_id === null)
        const draftId = tab?.draft_writing_id
        return draftId && draftId !== initialDraftId ? draftId : null
      },
      { label: "identidad efímera distinta de New Artifact", timeoutMs: EPHEMERAL_IDENTITY_TIMEOUT_MS },
    )
    await waitForHydrationReady("New Artifact hydration ready")
    expect(await coordinatorCapture.settle(), "New Artifact persistence settles").toBe(true)
    expect(await localDB.writings.get(newDraftId), "New Artifact creates no durable row").toBeNull()
    expect(await localDB.syncQueue.getCurrentForWriting(newDraftId), "New Artifact queues no upsert").toBeNull()
    expect(
      (await localDB.writings.getAll()).filter((writing) => !beforeBlankDraftIds.has(writing.id)),
      "neither blank draft creates another durable row",
    ).toEqual([])

    const secondMarker = "ODE626-WEB-NEW-ARTIFACT-CONTENT"
    await typeInEditor(secondMarker)
    await eventually(
      async () =>
        (await localDB.writings.getAll()).some(
          (writing) => !beforeBlankDraftIds.has(writing.id) && writing.body_text.includes(secondMarker),
        ),
      "New Artifact's first real content to become durable",
    )

    const secondCreated = (await localDB.writings.getAll()).filter(
      (writing) => !beforeBlankDraftIds.has(writing.id) && writing.body_text.includes(secondMarker),
    )
    expect(secondCreated).toHaveLength(1)
    expect((await localDB.writings.get(firstCreated[0]!.id))?.body_text).toContain(firstMarker)
    expect((await localDB.writings.get(firstCreated[0]!.id))?.body_text).not.toContain(secondMarker)
    await eventually(
      async () => {
        const mutation = await localDB.syncQueue.getCurrentForWriting(secondCreated[0]!.id)
        return mutation?.entity_kind === "writing" && mutation.operation === "upsert"
      },
      "an upsert for New Artifact's real content",
    )
  }, TEST_TIMEOUT_MS)
})
