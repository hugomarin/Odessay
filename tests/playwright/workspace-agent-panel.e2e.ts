import { expect, test } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"

/**
 * @contract ODE-512 — Workspace Agent session continuity in the web harness
 * @doc workflow/context/features/agents/odessay-agent-execution.md
 * @service WorkspaceAgentService (web boundary; not desktop mutation acceptance)
 */
test("opens the agent independently, preserves dropped context in chat, and reopens from its rail", async ({ page }) => {
  await page.goto("/perf/write-new-harness")
  const writingArea = page.getByTestId("editor-writing-area")
  const newFromEmptyState = page.getByTestId("editor-empty-state").getByRole("button", { name: "New Artifact" })
  if (!await writingArea.isVisible().catch(() => false) && await newFromEmptyState.isVisible().catch(() => false)) {
    // The harness can finish restoring its transient draft between the
    // visibility check and the click. A detached empty-state button is fine if
    // the writing area has become the stable destination.
    await newFromEmptyState.click({ timeout: 1_500 }).catch(async (cause: unknown) => {
      if (!await writingArea.isVisible().catch(() => false)) throw cause
    })
  }
  await expect(writingArea).toBeVisible()

  const agentToggle = page.locator('button[aria-label="Workspace agent"]')
  const openStartedAt = await page.evaluate(() => performance.now())
  await agentToggle.click()

  const panel = page.getByTestId("workspace-agent-panel")
  await expect(panel).toBeVisible()
  const panelOpenMs = await page.evaluate((startedAt) => performance.now() - startedAt, openStartedAt)
  await page.locator('button[aria-label="Properties panel"]').click()
  await expect(panel).toBeVisible()
  await mkdir("output/playwright/ode-486", { recursive: true })
  await page.screenshot({ path: "output/playwright/ode-486/agent-independent-panel.png" })

  await panel.locator("[data-workspace-agent-dropzone]").evaluate((element) => {
    element.dispatchEvent(new CustomEvent("workspace-agent-drop", {
      bubbles: true,
      detail: {
        kind: "file",
        id: "context-document",
        path: "/workspace/context.md",
        label: "context.md",
      },
    }))
  })
  await expect(page.getByTestId("workspace-agent-context")).toContainText("context.md")

  const draft = page.getByLabel("Message Workspace agent")
  await draft.fill("Summarize this context")
  await draft.press("Enter")
  await expect(page.getByTestId("workspace-agent-chat")).toContainText("Summarize this context")
  await expect(page.getByTestId("workspace-agent-message-context")).toContainText("context.md")
  await expect(page.getByTestId("workspace-agent-chat")).toHaveCSS("overflow-y", "auto")
  await page.getByRole("button", { name: "Remove context.md" }).click()
  await expect(page.getByTestId("workspace-agent-context")).toHaveCount(0)
  await expect(page.getByTestId("workspace-agent-message-context")).toContainText("context.md")
  await page.screenshot({ path: "output/playwright/ode-486/agent-context-chat.png" })

  await page.getByTestId("editor-topbar").getByRole("button", { name: "Focus mode" }).click()
  await expect(page.locator('[data-focus-mode="true"]')).toBeVisible()
  await expect(page.getByTestId("workspace-agent-focus-host")).toHaveCount(1)
  await page.screenshot({ path: "output/playwright/ode-486/agent-focus-mode.png" })
  await page.keyboard.press("Escape")
  await expect(page.locator('[data-focus-mode="false"]')).toBeVisible()
  await expect(page.getByTestId("workspace-agent-panel")).toBeVisible()
  await expect(page.getByTestId("workspace-agent-chat")).toContainText("Summarize this context")
  await expect(page.getByTestId("workspace-agent-message-context")).toContainText("context.md")

  await panel.getByRole("button", { name: "Close Workspace agent" }).click()
  const rail = page.getByTestId("workspace-agent-rail")
  await expect(rail).toBeVisible()
  const reopenStartedAt = await page.evaluate(() => performance.now())
  await rail.click()
  await expect(page.getByTestId("workspace-agent-panel")).toBeVisible()
  const panelReopenMs = await page.evaluate((startedAt) => performance.now() - startedAt, reopenStartedAt)
  await expect(page.getByTestId("workspace-agent-chat")).toContainText("Summarize this context")
  await expect(page.getByTestId("workspace-agent-message-context")).toContainText("context.md")
  await page.screenshot({ path: "output/playwright/ode-486/agent-reopened.png" })

  // ODE-502: switching to a different Writing changes the scope the panel is
  // grounded in, but the AgentSession itself (history, draft, pending review
  // state) is application state, not content-keyed — it must survive the
  // switch instead of remounting from scratch.
  const previousScopeId = await page.getByTestId("workspace-agent-panel").getAttribute("data-scope-id")
  const switchStartedAt = await page.evaluate(() => performance.now())
  await page.locator('button[aria-label="New Artifact"]').last().click()
  await expect.poll(async () => page.getByTestId("workspace-agent-panel").getAttribute("data-scope-id"))
    .not.toBe(previousScopeId)
  const documentSwitchMs = await page.evaluate((startedAt) => performance.now() - startedAt, switchStartedAt)
  await expect(page.getByTestId("workspace-agent-chat")).toContainText("Summarize this context")
  await expect(page.getByTestId("workspace-agent-message-context")).toContainText("context.md")
  await mkdir("output/playwright/ode-502", { recursive: true })
  await page.screenshot({ path: "output/playwright/ode-502/agent-tab-switch-preserved.png" })

  // The prior turn's message keeps the label of the Writing it was actually
  // asked from, now that we're grounded somewhere else.
  await expect(page.getByTestId("workspace-agent-message-scope").first()).toBeVisible()

  // "New conversation" is the only thing that resets the session.
  await page.getByTestId("workspace-agent-new-conversation").click()
  await expect(page.getByTestId("workspace-agent-chat")).not.toContainText("Summarize this context")
  await expect(page.getByTestId("workspace-agent-chat")).toContainText("Ask anything about this workspace or the open artifact.")
  await expect(page.getByTestId("workspace-agent-thinking")).toHaveCount(0)
  await expect(page.getByTestId("workspace-agent-context")).toHaveCount(0)
  await page.screenshot({ path: "output/playwright/ode-502/agent-new-conversation.png" })

  await writeFile(
    "output/playwright/ode-502/agent-performance.json",
    `${JSON.stringify({ panelOpenMs, panelReopenMs, documentSwitchMs }, null, 2)}\n`,
    "utf8",
  )
})
