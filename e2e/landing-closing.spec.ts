import { expect, test } from "@playwright/test";

const samples = [
  { width: 1440, locale: "en", mode: "light", route: "/features/tasks" },
  { width: 1554, locale: "vi", mode: "dark", route: "/" },
  { width: 768, locale: "vi", mode: "light", route: "/features/tasks" },
  { width: 390, locale: "en", mode: "dark", route: "/features/tasks" },
  { width: 390, locale: "vi", mode: "light", route: "/" },
] as const;

for (const sample of samples) {
  test(`product-led closing ${sample.width}-${sample.locale}-${sample.mode}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1050 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: sample.mode });
    await page.goto(sample.route);
    const closing = page.locator(".final-section");
    await expect(closing).toHaveCount(1);
    await closing.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await expect(closing).toHaveCSS("padding-top", sample.width < 768 ? "32px" : "48px");
    await expect(closing).toHaveCSS("padding-bottom", "0px");
    const title = closing.getByRole("heading", { level: 2 });
    const action = closing.getByRole("link");
    await expect(action).toHaveCount(1);
    await expect(action).toHaveAttribute("href", "/register");
    await expect(closing.getByRole("button")).toHaveCount(0);
    await expect(closing.locator(".lovable-application")).toHaveAttribute("inert", "");
    await expect(closing.locator("figcaption")).toContainText(sample.locale === "en" ? "Illustrative sample data" : "Dữ liệu mẫu minh họa");
    const frame = (await closing.boundingBox())!;
    const heading = (await title.boundingBox())!;
    const button = (await action.boundingBox())!;
    expect(frame.width).toBeLessThanOrEqual(1400);
    expect(frame.height).toBeLessThan(880);
    expect(heading.x + heading.width / 2).toBeCloseTo(frame.x + frame.width / 2, 0);
    expect(button.x + button.width / 2).toBeCloseTo(frame.x + frame.width / 2, 0);
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await action.focus();
    await expect(action).toBeFocused();
    await expect(action).toHaveCSS("outline-offset", "5px");
    await page.keyboard.press("Tab");
    expect(await closing.locator(":focus").count()).toBe(0);
    await closing.screenshot({ path: `.impeccable/review/closing-${sample.width}-${sample.locale}-${sample.mode}.png`, animations: "disabled", style: ".site-header, nextjs-portal { visibility: hidden !important; }" });
    await action.click();
    await expect(page).toHaveURL(/\/register$/, { timeout: 20000 });
  });
}
