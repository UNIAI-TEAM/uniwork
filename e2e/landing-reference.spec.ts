import { expect, test } from "@playwright/test";
import { selectWorkspaceFeature } from "./landing-catalog-helpers";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

for (const width of [1440, 390]) {
  test(`Lovable reference structure and remaining landing sections at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#du-an");
    const dir = resolve(import.meta.dirname, "../.impeccable/review");
    await mkdir(dir, { recursive: true });
    const capture = async (selector: string, name: string) => {
      const region = page.locator(selector);
      await region.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (name === "trust") {
        await page.locator(".security-explore").focus();
        await expect(page.locator(".landing-skip")).not.toBeFocused();
      }
      await page.mouse.move(0, 0);
      if (process.env.LANDING_CAPTURE === "1") await region.screenshot({ path: resolve(dir, `reference-${name}-${width}.png`), style: ".site-header { visibility: hidden !important; } nextjs-portal { display: none !important; }" });
    };
    if (width >= 768) {
      const player = page.locator("#product-preview .product-playback");
      await expect(player.locator(".action-kanban")).toBeVisible();
      const bounds = await player.locator(".action-stage").boundingBox();
      for (const card of await player.locator(".action-board-card:visible").all()) {
        const box = await card.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
      }
    } else {
      await expect(page.locator('[data-mobile-feature="tasks"]')).toBeVisible();
    }
    await capture(".product-playback", "tasks");
    await selectWorkspaceFeature(page, "meetings", false);
    if (width >= 768) {
      await expect(page.locator(".action-meeting.dark")).toBeVisible();
      await expect(page.locator(".action-meeting-chat")).toBeAttached();
    } else {
      await expect(page.locator('[data-mobile-feature="meetings"]')).toBeVisible();
    }
    await capture(".product-playback", "meetings");
    await selectWorkspaceFeature(page, "email", false);
    await expect(page.locator(width >= 768 ? ".action-mail-folders" : '[data-mobile-feature="email"]')).toBeVisible();
    await capture(".product-playback", "email");
    await selectWorkspaceFeature(page, "calendar");
    await expect(page.locator(width >= 768 ? ".reference-calendar" : '[data-mobile-feature="calendar"]')).toBeVisible();
    await expect(page.locator('[data-feature="calendar"] .workspace-preview-kind')).toHaveText("Minh họa");
    await capture('[role=tabpanel]:visible', "calendar");
    await selectWorkspaceFeature(page, "today");
    await expect(page.locator(".today-work-grid")).toBeVisible();
    await capture(".today-preview", "today");
    await page.locator(".today-task-panel button").last().click();
    await expect(page.locator(".preview-selection")).toContainText("brief");
    await page.locator(".solutions-section h2").click();
    for (const [selector, name] of [[".solutions-section", "solutions"], [".ai-section", "ai"], [".landing-trust-story", "trust"], [".landing-future-story", "roadmap"], [".pricing-section", "pricing"], [".landing-faq", "faq"], [".final-section", "closing"]]) {
      await capture(selector!, name!);
    }
    await expect(page.locator("body")).not.toContainText(/landing\.[a-zA-Z][\w.]+/);
    expect(errors).toEqual([]);
  });
}

for (const width of [1440, 390]) test(`Today rows and counts share completion, reopening and reset state at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#daily-tools");
  await selectWorkspaceFeature(page, "today");
  await page.locator(".today-task-panel button").first().click();
  await page.locator(".preview-detail-actions button").first().click();
  await selectWorkspaceFeature(page, "today");
  await expect(page.locator(".today-task-panel button").first().locator(".today-task-state")).toHaveText("done");
  await expect(page.locator(".today-summary button").first().locator("strong")).toHaveText("2");
  if (process.env.LANDING_CAPTURE === "1") await page.locator(".today-preview").screenshot({ path: resolve(import.meta.dirname, `../.impeccable/review/reference-today-completed-${width}.png`), style: ".site-header { visibility: hidden !important; } nextjs-portal { display: none !important; }" });
  await page.locator(".today-task-panel button").first().click();
  await page.locator(".preview-detail-actions button").first().click();
  await selectWorkspaceFeature(page, "today");
  await expect(page.locator(".today-task-panel button").first().locator(".today-task-state")).toHaveText("in_progress");
  await expect(page.locator(".today-summary button").first().locator("strong")).toHaveText("3");
  await page.locator(".today-task-panel button").last().click();
  await page.locator(".preview-detail-actions button").first().click();
  await selectWorkspaceFeature(page, "today");
  await expect(page.locator(".today-task-panel button").last().locator(".today-task-state")).toHaveText("done");
  await page.locator("[data-action='reset-preview']").click();
  await expect(page.locator(".today-task-panel button").last().locator(".today-task-state")).toHaveText("todo");
  await expect(page.locator(".today-summary button").first().locator("strong")).toHaveText("3");
});

test("skip link remains hidden without focus across tall section captures", async ({ page }) => {
  for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 960 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  // The shared app Providers remount landing after auth/config settles.
  // Focus assertions must use that final tree, not the pre-refresh DOM.
  await page.waitForLoadState("networkidle");
  const link = page.locator(".landing-skip");
  const region = page.locator(".landing-trust-story");
  await region.scrollIntoViewIfNeeded();
  await page.locator(".security-explore").focus();
  const probe = () => link.evaluate(element => ({ focused: element.matches(":focus"), transform: getComputedStyle(element).transform, top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, scrollY }));
  await region.screenshot();
  expect((await probe()).bottom).toBeLessThanOrEqual(0);
  await expect(link).toHaveCSS("clip-path", "inset(50%)");
  await page.goto("/");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".landing-site h1")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  expect((await probe()).top).toBeGreaterThanOrEqual(0);
  await expect(link).toHaveCSS("clip-path", "none");
  if (process.env.LANDING_CAPTURE === "1") await page.screenshot({ path: resolve(import.meta.dirname, `../.impeccable/review/skip-focused-${width}.png`), style: "nextjs-portal { display: none !important; }" });
  await page.locator(".security-explore").focus();
  expect((await probe()).bottom).toBeLessThanOrEqual(0);
  await expect(link).toHaveCSS("clip-path", "inset(50%)");
  if (process.env.LANDING_CAPTURE === "1") await page.screenshot({ path: resolve(import.meta.dirname, `../.impeccable/review/skip-unfocused-${width}.png`), style: "nextjs-portal { display: none !important; }" });
  }
});
