import { expect, test } from "@playwright/test";
import { selectWorkspaceFeature, workspaceGroups } from "./landing-catalog-helpers";

for (const sample of [{ width: 1440, theme: "light", locale: "vi" }, { width: 1440, theme: "dark", locale: "en" }, { width: 390, theme: "dark", locale: "vi" }] as const) {
  test(`Lovable reference fits every feature ${sample.width}-${sample.theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: sample.theme });
    await page.goto("/#tong-quan");
    await page.waitForLoadState("networkidle");
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), sample.theme);
    const workspace = page.locator("#product-preview");
    for (const feature of Object.values(workspaceGroups).flat()) {
      await selectWorkspaceFeature(page, feature, false);
      const canvas = workspace.locator(`.lovable-canvas[data-lovable-screen="${feature}"]`);
      if (sample.width === 390) {
        const focused = workspace.locator(`.mobile-feature-story[data-mobile-feature="${feature}"]`);
        await expect(focused).toBeVisible();
        await expect(canvas).toBeHidden();
        expect(await focused.innerText()).not.toContain("landing.");
        expect(await focused.locator(".mobile-story-detail p").evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        continue;
      }
      await expect(canvas).toBeVisible();
      await expect(canvas.locator(".lovable-sidebar")).toHaveCount(1);
      await expect(canvas.locator(".lovable-toolbar")).toHaveCount(1);
      expect(await canvas.innerText()).not.toMatch(/landing\.lovable\./);
      const geometry = await canvas.evaluate(node => {
        const box = node.getBoundingClientRect();
        const viewport = node.closest(".lovable-viewport")!.getBoundingClientRect();
        return { width: box.width, viewport: viewport.width, ratio: box.width / box.height, overflow: document.documentElement.scrollWidth - window.innerWidth };
      });
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.ratio).toBeCloseTo(1.76, 1);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      if (["dashboard", "tasks", "email", "meetings", "calendar", "ask", "documents"].includes(feature)) {
        await workspace.screenshot({ path: `.impeccable/review/lovable-${feature}-${sample.width}-${sample.theme}.png`, animations: "disabled" });
      }
    }
    await selectWorkspaceFeature(page, "dashboard", false);
    await workspace.locator("[data-action='expand-preview']").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (sample.width === 390) {
      await expect(dialog.locator(".mobile-feature-story")).toBeVisible();
      await expect(dialog.locator(".lovable-detail-toggle")).toHaveCount(0);
    } else {
      await expect(dialog.locator(".lovable-canvas")).toBeVisible();
      await dialog.locator(".lovable-detail-toggle").click();
      await expect(dialog.locator(".lovable-viewport")).toHaveAttribute("data-detail", "true");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(workspace.locator("[data-action='expand-preview']")).toBeFocused();
  });
}

test("scaled action film keeps the explicit assignment and completion sequence", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#du-an");
  await page.waitForLoadState("networkidle");
  const player = page.locator(".product-playback");
  await player.scrollIntoViewIfNeeded();
  await page.clock.install();
  await player.locator("[data-action='toggle-playback']").click();
  await page.clock.runFor(3 * 2600);
  await expect(player).toHaveAttribute("data-step", "3");
  await expect(player.locator('[data-demo-result="assignee"]')).toContainText("Hoàng Anh");
  await expect(player.locator(".action-state")).toHaveText("in_progress");
  await page.clock.runFor(3 * 2600);
  await expect(player).toHaveAttribute("data-step", "6");
  await expect(player.locator('[data-status="done"] [data-demo-item="design"]')).toHaveCount(1);
  await expect(player.locator(".lovable-task-stats > div").nth(2)).toContainText("4");
  await expect(player.locator(".lovable-task-stats > div").nth(3)).toContainText("8");
  await expect(player.locator(".lovable-assistant progress")).toHaveAttribute("value", "4");
  await expect(player.locator(".action-board-column")).toHaveCount(5);
  await expect(player.locator(".action-cursor")).not.toBeVisible();
  await player.locator("[data-action='toggle-playback']").click();
  await page.clock.runFor(10000);
  await expect(player).toHaveAttribute("data-step", "6");
});

test("expanded film preserves reduced motion and exposes playback controls", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#du-an");
  await page.waitForLoadState("networkidle");
  const player = page.locator("#product-preview .product-playback");
  await player.locator("[data-action='expand-preview']").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("data-reduced", "true");
  await expect(dialog.locator(".action-cursor")).toBeHidden();
  await page.clock.install();
  await dialog.getByRole("button", { name: "Phát demo", exact: true }).click();
  await expect(dialog).toHaveAttribute("data-running", "true");
  await page.clock.runFor(2600);
  await expect(dialog.locator(".action-drawer")).toBeVisible();
  await dialog.getByRole("button", { name: "Dừng demo", exact: true }).click();
  await page.clock.runFor(5000);
  await expect(dialog).toHaveAttribute("data-running", "false");
  await expect(dialog.locator(".action-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(player).toHaveAttribute("data-step", "1");
});

test("meeting listing pauses the film and returning to the room restores it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#hop");
  await page.waitForLoadState("networkidle");
  const player = page.locator(".product-playback");
  await expect(async () => {
    await expect(player).toHaveAttribute("data-feature-preview", "meetings");
    await player.evaluate(node => node.scrollIntoView({ behavior: "instant", block: "center" }));
    await expect(player).toBeInViewport({ ratio: .5 });
  }).toPass({ timeout: 10000 });
  await player.locator("[data-action='toggle-playback']").click();
  await player.evaluate(node => node.scrollIntoView({ behavior: "instant", block: "center" }));
  await expect(player).toHaveAttribute("data-running", "true");
  await page.clock.install();
  await page.clock.runFor(2600);
  await expect(player).toHaveAttribute("data-step", "1");
  await player.locator(".lovable-meeting-view-switch button").first().click();
  await expect(player.locator(".lovable-meeting-list")).toBeVisible();
  await expect(player).toHaveAttribute("data-running", "false");
  await page.clock.runFor(10000);
  await expect(player).toHaveAttribute("data-step", "1");
  await player.locator(".lovable-meeting-view-switch button").last().click();
  await expect(player.locator(".action-source-picker")).toBeVisible();
  await expect(player).toHaveAttribute("data-running", "true");
});
