import { test, expect } from "@playwright/test";
import { auditText } from "./contrast";

const cases = [
  { width: 1440, locale: "vi", theme: "light" },
  { width: 1510, locale: "en", theme: "dark" },
  { width: 768, locale: "en", theme: "light" },
  { width: 390, locale: "en", theme: "dark" },
  { width: 320, locale: "vi", theme: "light" },
] as const;

for (const scenario of cases) {
  test(`Why UniWork — ${scenario.width}px ${scenario.locale} ${scenario.theme}`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: scenario.theme });
    await context.addCookies([{ name: "uniwork-locale", value: scenario.locale, url: baseURL! }]);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/why-uniwork");
    await expect(page.locator(".why-hero h1")).toBeVisible();
    await expect(page.locator(".why-proof-figure")).toHaveCount(3);
    await expect(page.locator(".why-availability")).toContainText(scenario.locale === "vi" ? "Đang phát triển" : "In development");
    await page.locator(".why-compare-link").click();
    await expect(page).toHaveURL(/#comparison$/);
    const table = page.getByRole("table");
    await expect(table.locator("tbody tr")).toHaveCount(5);
    const brands = ["Microsoft 365", "Notion", "ClickUp", "Coda"];
    for (const brand of brands) {
      const button = page.locator(".why-platform-picker").getByRole("button", { name: brand, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(table.locator("thead")).toContainText(brand);
      await expect(page.locator(".why-platform-picker button[aria-pressed=true]")).toHaveCount(1);
      expect(await page.locator(".why-platform-picker img").evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
      await expect(page.locator(".why-sources a").first()).toHaveAttribute("href", /https:\/\/(?:www\.)?(?:microsoft\.com|notion\.com|clickup\.com|coda\.io)\//);
      const contrast = await auditText(page, ".why-page");
      expect(contrast.fails, contrast.fails.join(" | ")).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    }
    // A pointer-selected option must also be operable in keyboard mode.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".why-platform-picker button").last()).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator(".why-platform-picker button").last()).toHaveAttribute("aria-pressed", "true");
    expect(await page.locator(".why-page").innerText()).not.toMatch(/landing\.(?:why|catalog)\./);
    expect(errors).toEqual([]);
    await page.locator(".why-proof-work a").click();
    await expect(page).toHaveURL(/\/features\/tasks$/);
  });
}
