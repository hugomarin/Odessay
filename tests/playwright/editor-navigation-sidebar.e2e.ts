import { expect, test } from "@playwright/test";
import { openEditorHarness } from "./helpers/editor";

test("Studio navigation switches between one shared Contents and Workspace sidebar", async ({
  page,
}) => {
  await openEditorHarness(page);

  const sidebar = page.getByTestId("editor-navigation-sidebar");
  await expect(sidebar.getByText("Contents", { exact: true })).toBeVisible();
  await expect(sidebar.locator("aside")).toHaveCSS(
    "height",
    await sidebar.evaluate(
      (node) => `${node.getBoundingClientRect().height}px`,
    ),
  );
  await page.screenshot({
    path: "output/playwright/ode-410-contents.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Workspace" }).click();
  await expect(
    sidebar.getByText("Workspace", { exact: true }).last(),
  ).toBeVisible();
  await expect(
    sidebar.getByText("Este writing no pertenece a un Workspace."),
  ).toBeVisible();
  await expect(sidebar.getByText("Contents", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "output/playwright/ode-410-workspace-empty.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "TOC" }).click();
  await expect(sidebar.getByText("Contents", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Workspace", { exact: true })).toHaveCount(1);
});
