import { expect, test } from "@playwright/test";

for (const width of [1910, 1440, 768, 390]) {
  test(`product stage shares the landing frame at ${width}px`, async ({ page, context, baseURL }) => {
    const locale = width === 1440 || width === 768 ? "vi" : "en";
    await context.addCookies([{ name: "uniwork-locale", value: locale, url: baseURL! }]);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: width === 390 ? "dark" : "light" });
    await page.goto("/#du-an");
    const workspace = page.locator("#product-preview");
    await expect(workspace.locator(width < 768 ? ".mobile-feature-story" : ".lovable-canvas")).toBeVisible();
    await expect(page.locator(".demo-director, .demo-beats, .workspace-availability, .hero-scene-footer, .preview-caption")).toHaveCount(0);
    await expect(page.locator("#platform-title")).toHaveClass("sr-only");
    const geometry = await workspace.evaluate(node => {
      const box = node.getBoundingClientRect();
      const preview = node.querySelector(".lovable-viewport, .mobile-feature-story")!.getBoundingClientRect();
      return { left: box.left, right: innerWidth - box.right, preview: preview.width, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    const frame = await page.locator(".platform-section").boundingBox();
    const companion = await page.locator(".ai-stage").boundingBox();
    expect(frame!.width).toBeLessThanOrEqual(1400);
    expect(frame!.x).toBeCloseTo(companion!.x, 0);
    expect(frame!.width).toBeCloseTo(companion!.width, 0);
    expect(geometry.left).toBeCloseTo(geometry.right, 0);
    expect(geometry.preview).toBeGreaterThan(width < 768 ? 350 : width < 1000 ? 700 : 1100);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    const player = workspace.locator(".product-playback");
    await expect(player).toHaveAttribute("data-running", "false");
    const playback = player.locator('[data-action="toggle-playback"]');
    if (width >= 768) {
      await playback.click();
      await expect(player).toHaveAttribute("data-running", "true");
      await playback.click();
      await expect(player).toHaveAttribute("data-running", "false");
    } else {
      await expect(playback).toHaveCount(0);
    }
    await workspace.screenshot({ path: `.impeccable/review/density-${width}.png`, animations: "disabled" });
    await workspace.locator('[data-action="toggle-presentation"]').click();
    await expect(workspace.locator('[data-action="reset-preview"]')).toBeVisible();
    await workspace.locator('[data-action="reset-preview"]').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const solutions = page.locator(".solutions-section");
    await solutions.scrollIntoViewIfNeeded();
    const title = await solutions.locator(".studio-title").boundingBox();
    const description = await solutions.locator(".studio-description").boundingBox();
    const heading = await solutions.locator(".studio-heading-row").boundingBox();
    expect(title!.x).toBeCloseTo(description!.x, 0);
    expect(description!.y - title!.y - title!.height).toBeLessThanOrEqual(17);
    expect(heading!.height).toBeLessThan(width < 768 ? 240 : 220);
    await solutions.locator(".solution-select").last().click();
    await expect(solutions.locator("#solution-preview")).toHaveAttribute("data-audience", "operations");
    await solutions.locator(".solution-select").first().focus();
    await page.keyboard.press("Enter");
    await expect(solutions.locator("#solution-preview")).toHaveAttribute("data-audience", "leaders");
    await solutions.locator(".solution-select").nth(1).click();
    await solutions.screenshot({ path: `.impeccable/review/density-solutions-${width}.png`, animations: "disabled" });
  });
}
