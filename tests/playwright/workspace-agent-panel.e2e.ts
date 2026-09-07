import { expect, test } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"

test("opens the agent independently, preserves dropped context in chat, and reopens from its rail", async ({ page }) => {
  await page.goto("/perf/write-new-harness")
  const newFromEmptyState = page.getByTestId("editor-empty-state").getByRole("button", { name: "New Artifact" })
  if (await newFromEmptyState.isVisible().catch(() => false)) {
    await newFromEmptyState.click()
  }
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()

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

  await panel.evaluate((element) => {
    const dataTransfer = new DataTransfer()
    dataTransfer.setData("application/x-odessay-agent-context", JSON.stringify({
      kind: "file",
      id: "context-document",
      path: "/workspace/context.md",
      label: "context.md",
    }))
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }))
  })
  await expect(page.getByTestId("workspace-agent-context")).toContainText("context.md")

  const draft = page.getByLabel("Message Workspace agent")
  await draft.fill("Summarize this context")
  await page.getByRole("button", { name: "Send message" }).click()
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

  const previousScopeId = await page.getByTestId("workspace-agent-panel").getAttribute("data-scope-id")
  const resetStartedAt = await page.evaluate(() => performance.now())
  await page.locator('button[aria-label="New Artifact"]').last().click()
  await expect.poll(async () => page.getByTestId("workspace-agent-panel").getAttribute("data-scope-id"))
    .not.toBe(previousScopeId)
  const documentResetMs = await page.evaluate((startedAt) => performance.now() - startedAt, resetStartedAt)
  await expect(page.getByTestId("workspace-agent-chat")).toHaveCount(0)
  await expect(page.getByTestId("workspace-agent-context")).toHaveCount(0)
  await expect(page.getByTestId("workspace-agent-results")).toHaveCount(0)
  await page.screenshot({ path: "output/playwright/ode-486/agent-document-switch-reset.png" })
  await writeFile(
    "output/playwright/ode-486/agent-performance.json",
    `${JSON.stringify({ panelOpenMs, panelReopenMs, documentResetMs }, null, 2)}\n`,
    "utf8",
  )
})
