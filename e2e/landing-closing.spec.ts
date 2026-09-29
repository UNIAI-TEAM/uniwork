import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";

const samples = [
  { width: 1440, locale: "en", mode: "light", route: "/features/tasks" },
  { width: 1554, locale: "vi", mode: "dark", route: "/" },
  { width: 768, locale: "vi", mode: "light", route: "/features/tasks" },
  { width: 390, locale: "en", mode: "dark", route: "/features/tasks" },
  { width: 390, locale: "vi", mode: "light", route: "/" },
  { width: 1254, locale: "vi", mode: "light", route: "/solutions/product" },
  { width: 390, locale: "en", mode: "dark", route: "/solutions/operations" },
  { width: 1510, locale: "en", mode: "dark", route: "/features/documents" },
  { width: 320, locale: "vi", mode: "light", route: "/features/documents" },
] as const;

for (const sample of samples) {
  test(`product-led closing ${sample.route} ${sample.width}-${sample.locale}-${sample.mode}`, async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.addCookies([{ name: "uniwork-locale", value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1050 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: sample.mode });
    await page.goto(sample.route);
    const closing = page.locator(".final-section");
    await expect(closing).toHaveCount(1);
    await closing.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const compact = sample.route !== "/";
    const title = closing.getByRole("heading", { level: 2 });
    const action = closing.locator('a[href="/register"]');
    await expect(action).toHaveAttribute("href", "/register");
    await expect(closing.getByRole("button")).toHaveCount(0);
    if (compact) {
      await expect(closing.getByRole("link")).toHaveCount(2);
      await expect(closing.locator(".lovable-application, figure")).toHaveCount(0);
      const demo = closing.locator(".final-compact-demo");
      const demoHref = sample.route.startsWith("/features/") ? "#feature-preview"
        : sample.route === "/solutions/product" ? "/features/tasks#feature-preview"
        : sample.route === "/solutions/operations" ? "/features/organization#feature-preview" : "/#platform";
      await expect(demo).toHaveAttribute("href", demoHref);
      if (sample.route === "/solutions/product") await expect(title).toHaveText("Cùng xây dựng sản phẩm, trong một workspace.");
      if (sample.route === "/solutions/operations") await expect(title).toHaveText("Bring daily operations into one place.");
      if (sample.route.startsWith("/features/")) {
        await expect(page.locator(".feature-page-related")).not.toContainText("in_progress");
        if (sample.route === "/features/documents") {
          const related = page.locator(".feature-page-related");
          await expect(related.locator('a[href="/features/outputs"]')).toBeVisible();
          await expect(related.locator('a[href="/features/approvals"]')).toBeVisible();
          await expect(related.locator(".feature-related-preview")).toHaveCount(2);
        }
        await demo.click();
        await expect(page).toHaveURL(/#feature-preview$/);
        await expect(page.locator("#feature-demo-title")).toBeInViewport();
        await closing.scrollIntoViewIfNeeded();
      }
    } else {
      await expect(closing.getByRole("link")).toHaveCount(1);
      await expect(closing).toHaveCSS("padding-top", sample.width < 768 ? "32px" : "48px");
      await expect(closing).toHaveCSS("padding-bottom", "0px");
      await expect(closing.locator(".lovable-application")).toHaveAttribute("inert", "");
      await expect(closing.locator("figcaption")).toContainText(sample.locale === "en" ? "Illustrative sample data" : "Dữ liệu mẫu minh họa");
    }
    const frame = (await closing.boundingBox())!;
    const heading = (await title.boundingBox())!;
    const button = (await action.boundingBox())!;
    expect(frame.width).toBeLessThanOrEqual(compact ? sample.width : 1400);
    expect(frame.height).toBeLessThan(880);
    if (compact) {
      expect(frame.height).toBeLessThan(640);
      expect(heading.x + heading.width / 2).toBeCloseTo(frame.x + frame.width / 2, 0);
      expect(button.x + button.width).toBeLessThan(frame.x + frame.width);
    } else {
      expect(heading.x + heading.width / 2).toBeCloseTo(frame.x + frame.width / 2, 0);
      expect(button.x + button.width / 2).toBeCloseTo(frame.x + frame.width / 2, 0);
    }
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    if (compact) expect((await auditText(page, ".final-compact-section")).fails).toEqual([]);
    expect(errors).toEqual([]);
    await action.focus();
    // A preceding demo click uses pointer modality; enter keyboard modality before checking its ring.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(action).toBeFocused();
    await expect(action).toHaveCSS("outline-offset", compact ? "3px" : "5px");
    await page.keyboard.press("Tab");
    if (compact) await expect(closing.locator(".final-compact-demo")).toBeFocused();
    else expect(await closing.locator(":focus").count()).toBe(0);
    await closing.screenshot({ path: `.impeccable/review/closing-${sample.route.replaceAll("/", "-")}-${sample.width}-${sample.locale}-${sample.mode}.png`, animations: "disabled", style: ".site-header, nextjs-portal { visibility: hidden !important; }" });
    await action.click();
    await expect(page).toHaveURL(/\/register$/, { timeout: 20000 });
  });
}
