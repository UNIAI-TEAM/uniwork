import { expect, test } from "@playwright/test";
import { gotoLanding, landingReady } from "./landing-ready";

test("the real task board is the default demo and plays its action sequence", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/#platform");
  await landingReady(page);
  await page.waitForLoadState("networkidle");
  const stage = page.locator("#product-preview");
  await expect(stage).toHaveAttribute("data-presentation", "watch");
  const player = stage.locator('.product-playback[data-feature-preview="tasks"]');
  await expect(player).toBeVisible();
  await expect(player.locator(".product-task-column")).toHaveCount(6);
  for (const status of ["backlog", "todo", "in_progress", "in_review", "done", "blocked"]) {
    await expect(player.locator(`.product-task-column[data-status="${status}"]`)).toBeAttached();
  }
  const card = player.locator('[data-demo-item="design"]');
  await expect(card.locator('[data-slot="task-card"]')).toBeVisible();
  await expect(card).toContainText("UNI-18");
  await expect(player.locator(".preview-category")).toHaveCount(0);
  await expect(player).toHaveAttribute("data-step", "0");
  await player.screenshot({ path: ".impeccable/review/actual-task-board-1440.png", animations: "disabled" });
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<typeof original>) {
      if (this instanceof HTMLElement && this.dataset.demoItem) this.dataset.observedMotion = JSON.stringify(args[0]);
      return original.apply(this, args);
    };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await player.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-running", "true");
  await expect(player.locator('[data-demo-detail="task"]')).toBeVisible({ timeout: 6000 });
  await expect(player.locator('[data-demo-result="assignee"]')).toContainText("Hoàng Anh", { timeout: 10_000 });
  await expect(player.locator('[data-status="done"] [data-demo-item="design"]')).toBeVisible({ timeout: 12_000 });
  const moved = player.locator('[data-status="done"] [data-demo-item="design"]');
  await expect(moved).toHaveAttribute("data-observed-motion", /translate/);
  await player.locator('[data-action="toggle-playback"]').click();
  await stage.screenshot({ path: ".impeccable/review/actual-task-done-1440.png", animations: "disabled" });
  await stage.locator('[data-feature="chat"]').click();
  await expect(stage.locator('.product-playback[data-feature-preview="chat"]')).toHaveAttribute("data-running", "true");
});

test("the current task board fits the app's dark theme", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await gotoLanding(page, "/#platform");
  await landingReady(page);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const stage = page.locator("#product-preview");
  await expect(stage.locator(".product-playback .product-task-column")).toHaveCount(6);
  await expect(stage).not.toContainText(/(?:tasks|landing)\.[a-z][\w.]+/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await stage.screenshot({ path: ".impeccable/review/actual-task-board-dark-1440.png", animations: "disabled" });
});

test("the matching board remains usable in manual mode on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/#du-an");
  await landingReady(page);
  const stage = page.locator("#product-preview");
  await stage.locator('[data-action="toggle-presentation"]').click();
  const panel = stage.getByRole("tabpanel");
  await expect(panel.locator(".product-task-column")).toHaveCount(6);
  await panel.locator('[data-demo-task="design"]').click();
  await expect(panel.locator(".product-task-details")).toBeVisible();
  await panel.locator('[data-action="complete-task"]').click();
  await panel.locator('[data-action="close-task"]').click();
  await expect(panel.locator('[data-status="done"] [data-demo-task="design"]')).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await stage.screenshot({ path: ".impeccable/review/actual-task-board-390.png", animations: "disabled" });
});
