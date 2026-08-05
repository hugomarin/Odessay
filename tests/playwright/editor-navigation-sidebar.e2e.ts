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
    // The harness runs in a browser, where the runtime cannot read the
    // filesystem — it must say so instead of denying membership.
    sidebar.getByText("solo está disponible en la app de escritorio", {
      exact: false,
    }),
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

test("both sidebar modes occupy the same box inside a frame that never scrolls", async ({
  page,
}) => {
  await openEditorHarness(page);

  const aside = page.getByTestId("editor-navigation-sidebar").locator("aside");
  const contentsBox = await aside.boundingBox();

  await page.getByRole("button", { name: "Workspace" }).click();
  await expect(
    page.getByText("solo está disponible en la app de escritorio", {
      exact: false,
    }),
  ).toBeVisible();
  const workspaceBox = await aside.boundingBox();

  // Shared chrome parity: zero delta between modes at the same viewport.
  expect(workspaceBox).toEqual(contentsBox);

  // The editor is a fixed-height frame. If it grows past the shell the page
  // scrolls, and the absolutely positioned sidebar is dragged out of view above
  // the frame — taking its mode controls and header with it.
  const frame = await page.evaluate(() => {
    const section = document.querySelector("#editor");
    return {
      documentOverflow:
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight,
      sectionHeight: section?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
    };
  });
  expect(frame.documentOverflow).toBe(0);
  expect(Math.round(frame.sectionHeight)).toBe(frame.viewportHeight);

  await page.mouse.move(
    (contentsBox?.x ?? 0) + 40,
    (contentsBox?.y ?? 0) + 120,
  );
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(200);

  const afterWheel = await page.evaluate(() => ({
    scrollTop: document.documentElement.scrollTop,
    asideTop:
      document
        .querySelector('[data-testid="editor-navigation-sidebar"] aside')
        ?.getBoundingClientRect().top ?? -1,
  }));
  expect(afterWheel.scrollTop).toBe(0);
  expect(afterWheel.asideTop).toBeGreaterThanOrEqual(0);
});
