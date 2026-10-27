import { expect, test } from "@playwright/test";
import { selectWorkspaceFeature, workspaceGroups } from "./landing-catalog-helpers";
import { landingReady, gotoLanding } from "./landing-ready";

for (const sample of [{ width: 1440, theme: "light", locale: "vi" }, { width: 1440, theme: "dark", locale: "en" }, { width: 390, theme: "dark", locale: "vi" }] as const) {
  test(`Lovable reference fits every feature ${sample.width}-${sample.theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: sample.theme });
    await gotoLanding(page, "/#tong-quan");
    await landingReady(page);
    await page.waitForLoadState("networkidle");
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), sample.theme);
    const workspace = page.locator("#product-preview");
    for (const feature of Object.values(workspaceGroups).flat()) {
      await selectWorkspaceFeature(page, feature, false);
      const hasCurrentScreen = ["dashboard", "tasks", "meetings", "chat", "email", "ask", "today", "documents", "calendar", "projects", "organization", "audit"].includes(feature);
      const shell = workspace.locator(`.product-demo-shell[data-demo-feature="${feature}"]`);
      if (hasCurrentScreen) {
        await expect(shell).toBeVisible();
        expect(await shell.innerText()).not.toMatch(/landing\.lovable\./);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        continue;
      }
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
      // Embedded in the product shell the reference draws only the screen body: the shell owns the sidebar and toolbar.
      await expect(canvas).toHaveAttribute("data-embedded", "true");
      await expect(canvas.locator(".lovable-sidebar, .lovable-toolbar")).toHaveCount(0);
      await expect(workspace.locator(".product-demo-sidebar")).toHaveCount(1);
      expect(await canvas.innerText()).not.toMatch(/landing\.lovable\./);
      const geometry = await canvas.evaluate(node => {
        const box = node.getBoundingClientRect();
        const viewport = node.closest(".lovable-viewport")!.getBoundingClientRect();
        return { width: box.width, viewport: viewport.width, ratio: box.width / box.height, overflow: document.documentElement.scrollWidth - window.innerWidth };
      });
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1);
      // The embedded canvas is 1500x928.
      expect(geometry.ratio).toBeCloseTo(1500 / 928, 1);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      if (["workflows", "outputs", "approvals", "knowledge", "agents", "automation"].includes(feature)) {
        await workspace.screenshot({ path: `.impeccable/review/lovable-${feature}-${sample.width}-${sample.theme}.png`, animations: "disabled" });
      }
    }
  });
}
