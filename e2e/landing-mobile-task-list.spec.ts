import { expect, test } from "@playwright/test";
import { landingReady } from "./landing-ready";
import { auditText } from "./contrast";

for (const sample of [
  { width: 320, prefix: "/vi", theme: "light" },
  { width: 390, prefix: "", theme: "dark" },
  { width: 767, prefix: "", theme: "light" },
] as const) {
  test(`mobile task demos use readable grouped lists at ${sample.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: sample.width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: sample.theme });
    await page.goto(`${sample.prefix}/#platform`);
    await landingReady(page);
    const preview = page.locator("#product-preview");
    const board = preview.locator(".product-task-board:visible");
    await expect(board).toHaveAttribute("data-view", "list");
    await expect(board.locator(".product-task-list-title")).toHaveCount(10);
    const columns = board.locator(".product-task-columns");
    expect(await columns.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await board.locator(".product-task-list-title").evaluateAll(elements => elements.every(element => {
      const style = getComputedStyle(element);
      return element.scrollWidth <= element.clientWidth + 1 && style.whiteSpace === "normal" && style.webkitLineClamp === "none";
    }))).toBe(true);

    await preview.locator('[data-action="toggle-presentation"]').click();
    await expect(board).toHaveAttribute("data-view", "list");
    await board.locator('[data-demo-task="design"]').click();
    await expect(board.locator('[data-demo-detail="task"]')).toBeVisible();
    await board.locator('[data-action="close-task"]').click();
    await preview.locator('[data-action="toggle-demo-menu"]').click();
    await preview.locator('[data-feature="today"]').click();
    await expect(board).toHaveAttribute("data-view", "list");
    expect(await board.locator(".product-task-columns").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    const poster = page.locator(".final-product-window");
    await expect(poster.locator(".product-task-board")).toHaveAttribute("data-view", "list");
    await expect(poster.locator(".product-task-list-title")).toHaveCount(3);
    expect(await poster.locator(".product-task-columns").evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    expect(await poster.evaluate(element => {
      const shell = element.querySelector(".product-demo-shell")!;
      return shell.getBoundingClientRect().width <= element.getBoundingClientRect().width + 1;
    })).toBe(true);
    await expect(poster.locator(".product-demo-sidebar")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("desktop keeps board layout, while responsive defaults do not override a chosen view", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#platform");
  await landingReady(page);
  const preview = page.locator("#product-preview");
  const board = preview.locator(".product-task-board:visible");
  await expect(board).toHaveAttribute("data-view", "board");
  await expect(page.locator(".final-product-window .product-task-board")).toHaveAttribute("data-view", "board");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(board).toHaveAttribute("data-view", "list");
  await preview.locator('[data-action="toggle-presentation"]').click();
  await board.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("menuitem", { name: "Board", exact: true }).click();
  await expect(board).toHaveAttribute("data-view", "board");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(board).toHaveAttribute("data-view", "board");
});

test("mobile autoplay still completes its task workflow in list view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#platform");
  await landingReady(page);
  const player = page.locator("#product-preview .product-playback");
  await player.scrollIntoViewIfNeeded();
  await page.bringToFront();
  await expect(player.locator(".product-task-board")).toHaveAttribute("data-view", "list");
  await player.locator('[data-action="toggle-playback"]').click();
  await expect(player).toHaveAttribute("data-running", "true");
  await expect(player).toHaveAttribute("data-step", "6", { timeout: 30_000 });
  await expect(player.locator('[data-status="done"] [data-demo-item="design"]')).toBeVisible();
  expect(await player.locator(".product-task-columns").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test("mobile list labels retain readable contrast in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.goto("/#platform");
    await landingReady(page);
    await expect(page.locator("#product-preview .product-task-board:visible")).toHaveAttribute("data-view", "list");
    const result = await auditText(page, '#product-preview .product-task-board[data-view="list"]');
    expect(result.checked).toBeGreaterThan(20);
    expect(result.fails, theme).toEqual([]);
  }
});
