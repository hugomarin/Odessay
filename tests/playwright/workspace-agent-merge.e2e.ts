import { expect, test } from "@playwright/test"

/**
 * @contract ODE-512 — web must not impersonate desktop semantic mutation
 * @doc workflow/context/features/agents/odessay-agent-execution.md
 * @service WorkspaceAgentService runtime boundary
 */
test("keeps Merge behind the desktop Workspace boundary in web", async ({ page }) => {
  await page.goto("/perf/write-new-harness")
  await expect(page.getByTestId("editor-writing-area")).toBeVisible()

  await page.locator('button[aria-label="Workspace agent"]').click()
  await expect(page.getByTestId("workspace-agent-panel")).toBeVisible()
  await page.getByTestId("workspace-agent-actions-trigger").click()

  const mergeAction = page.getByTestId("workspace-agent-action-merge")
  await expect(mergeAction).toBeVisible()
  await expect(mergeAction).toBeDisabled()
  await expect(mergeAction).toContainText("Propone una estructura única")
})
