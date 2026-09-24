import { expect, test } from "@playwright/test";

// Regression coverage for the demo's lower edge and the compact Starter offer.
for (const sample of [
  { width: 1440, locale: "en", theme: "light" },
  { width: 1440, locale: "en", theme: "dark" },
  { width: 1024, locale: "vi", theme: "dark" },
  { width: 390, locale: "vi", theme: "dark" },
] as const) {
  test(`demo and Starter stay compact ${sample.width}-${sample.theme}`, async ({ page, context, baseURL }) => {
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
      // The final group must remain reachable within the independently scrolling menu.
      await workspace.locator('[data-feature-group="organization"]').click();
      await expect(workspace.locator('[data-feature="reports"]')).toBeVisible();
    }
    await workspace.screenshot({ path: `.impeccable/review/density-demo-${sample.width}-${sample.theme}.png`, animations: "disabled" });

    const offer = page.locator(".pricing-offer");
    await offer.scrollIntoViewIfNeeded();
    expect((await offer.boundingBox())!.height).toBeLessThan(sample.width > 900 ? 400 : 560);
    await expect(offer.locator('a[href="/register"]')).toBeVisible();
    await expect(offer.locator(".pricing-status")).toBeVisible();
    await expect(offer.locator(".pricing-plan-diagram")).toHaveCount(0);
    await expect(offer.locator(".pricing-quotas li").first()).toBeHidden();
    await offer.screenshot({ path: `.impeccable/review/density-starter-${sample.width}-${sample.theme}.png`, animations: "disabled" });
    await offer.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(offer.locator("details")).toHaveAttribute("open", "");
    await expect(offer.locator(".pricing-quotas li")).toHaveCount(8);
    await expect(offer.locator(".pricing-quotas li").last()).toBeVisible();
    await expect(offer.locator('a[href="/learn#setup"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await offer.screenshot({ path: `.impeccable/review/density-starter-open-${sample.width}-${sample.theme}.png`, animations: "disabled" });
  });
}
