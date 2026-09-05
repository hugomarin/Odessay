import { expect, test } from "@playwright/test"
import { mkdir } from "node:fs/promises"

test("opens the agent independently, preserves dropped context in chat, and reopens from its rail", async ({ page }) => {
  await page.goto("/perf/write-new-harness")
  await expect(page.getByTestId("editor-empty-state")).toBeVisible()
  await page.getByTestId("editor-empty-state").getByRole("button", { name: "New Artifact" }).click()
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()

  const agentToggle = page.locator('button[aria-label="Workspace agent"]')
  await agentToggle.click()

  const panel = page.getByTestId("workspace-agent-panel")
  await expect(panel).toBeVisible()
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

  await panel.getByRole("button", { name: "Close Workspace agent" }).click()
  const rail = page.getByTestId("workspace-agent-rail")
  await expect(rail).toBeVisible()
  await rail.click()
  await expect(page.getByTestId("workspace-agent-panel")).toBeVisible()
  await expect(page.getByTestId("workspace-agent-chat")).toContainText("Summarize this context")
  await expect(page.getByTestId("workspace-agent-message-context")).toContainText("context.md")
  await page.screenshot({ path: "output/playwright/ode-486/agent-reopened.png" })
})
