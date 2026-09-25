import { expect, test } from "@playwright/test";

for (const sample of [
  { width: 1440, locale: "en", theme: "light" },
  { width: 1440, locale: "en", theme: "dark" },
  { width: 1024, locale: "vi", theme: "dark" },
  { width: 390, locale: "vi", theme: "dark" },
] as const) {
  test(`V2 demo fits the original landing ${sample.width}-${sample.theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: sample.theme });
    await page.goto("/#tong-quan");
    await page.waitForLoadState("networkidle");
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), sample.theme);
    const workspace = page.locator("#product-preview");
    if (sample.width > 900) {
      await expect(workspace.locator('[data-lovable-screen="dashboard"]')).toBeVisible();
      const gap = await workspace.evaluate(node => {
        const display = node.querySelector(".workspace-display")!.getBoundingClientRect();
        const frame = node.querySelector(".preview-window")!.getBoundingClientRect();
        return display.bottom - frame.bottom;
      });
      expect(gap).toBeLessThanOrEqual(2);
      await workspace.locator('[data-feature-group="organization"]').click();
      await expect(workspace.locator('[data-feature="reports"]')).toBeVisible();
    } else {
      const story = workspace.locator(".mobile-feature-story");
      await expect(story).toBeVisible();
      const initial = await story.locator(".mobile-story-detail").innerText();
      await story.locator("button").nth(1).click();
      await expect(story.locator("button").nth(1)).toHaveAttribute("aria-pressed", "true");
      await expect(story.locator(".mobile-story-detail")).not.toHaveText(initial);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await workspace.screenshot({ path: `.impeccable/review/ported-demo-${sample.width}-${sample.theme}.png`, animations: "disabled" });

    // The V2 demo must not replace the original landing's pricing or roadmap.
    await expect(page.locator(".pricing-plan-diagram")).toHaveCount(1);
    await expect(page.locator(".roadmap-hero")).toHaveCount(1);
    await expect(page.locator(".work-journey")).toHaveCount(0);
    if (sample.width >= 1100) {
      await page.locator(".header-directory-toggle").first().click();
      await expect(page.locator('#header-directory-products a[href^="/features/"]')).toHaveCount(18);
    }
  });
}
