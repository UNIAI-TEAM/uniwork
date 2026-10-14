import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { auditText } from "./contrast";
import { landingReady } from "./landing-ready";

async function checkHeroBackground(page: Page) {
  const loaded = await page.locator(".landing-hero").evaluate(async element => {
    const source = getComputedStyle(element).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
    if (!source) return false;
    const background = new Image();
    background.src = source;
    await background.decode();
    return background.naturalWidth > 0;
  });
  expect(loaded).toBe(true);
  expect((await auditText(page, ".landing-hero")).fails).toEqual([]);
}

async function checkHeaderFits(page: Page) {
  const outside = await page.locator(".site-header").evaluate(header => {
    const bounds = header.getBoundingClientRect();
    return Array.from(header.querySelectorAll(".header-shell a, .header-shell button"))
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
      })
      .map(element => element.textContent || element.getAttribute("aria-label"));
  });
  expect(outside).toEqual([]);
}

for (const width of [1440, 1280, 1100, 1099, 768, 390]) {
  test(`opening stays readable with working navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await landingReady(page);
    await expect(page.locator(".header-shell")).toHaveCSS("display", "flex");
    await expect(page.locator(".landing-hero-stage")).toHaveCSS("display", "flex");
    await expect(page.locator(".landing-hero-copy")).toHaveCSS("text-align", "center");
    await expect(page.locator(".landing-hero-actions")).toHaveCSS("justify-content", "center");
    await expect(page.locator("#landing-title")).toBeVisible();
    await checkHeaderFits(page);
    await checkHeroBackground(page);
    for (const action of await page.locator(".landing-hero-actions a").all()) await expect(action).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator(".landing-hero, .site-header").allTextContents()).join(" ")).not.toContain("landing.");
    await expect(page.locator('.hero-product-callout')).toHaveCount(0);
    await expect(page.locator('.hero-product-feature, .landing-hero img')).toHaveCount(0);
    await expect(page.locator('.landing-hero-actions a')).toHaveCount(2);
    await expect(page.locator(".hero-scene-footer, .hero-scene-caption")).toHaveCount(0);
    const dir = resolve(import.meta.dirname, "../.impeccable/review");
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: resolve(dir, `opening-${width}.png`), style: "nextjs-portal { visibility: hidden !important; }" });
    const header = page.getByRole("banner");
    if (width >= 1240) {
      await expect(page.locator(".header-navigation .header-nav-link")).toHaveText(["Sản phẩm", "Giải pháp", "Office", "Tìm hiểu", "Bảng giá", "Nhật ký cập nhật"]);
      await expect(page.locator('.header-navigation a.header-nav-link[href="/changelog"]')).toHaveText("Nhật ký cập nhật");
      const toggle = header.getByRole("button", { name: "Sản phẩm", exact: true });
      await toggle.click();
      await expect(page.locator("#header-directory-products")).toBeVisible();
      await expect(page.locator('#header-directory-products a[href="/features/agents"]')).toHaveText("Nhân sự AI");
      await page.locator('#header-directory-products a[href="/features/dashboard"]').focus();
      await expect(page.locator('#header-directory-products a[href="/features/dashboard"]')).toBeFocused();
      await page.screenshot({ path: resolve(dir, `opening-menu-${width}.png`), style: "nextjs-portal { visibility: hidden !important; }" });
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(page.locator("#header-directory-products")).toHaveCount(0);
      await header.getByRole("button", { name: "Office", exact: true }).click();
      await expect(page.locator('#header-directory-office a[href="/office#office-business"]')).toBeVisible();
      // Office for Personal is announced, not offered: a label without a link (office-header.test.tsx).
      await expect(page.locator("#header-directory-office [data-office-personal]")).toContainText("Đang phát triển");
      await expect(page.locator("#header-directory-office a")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await header.getByRole("button", { name: "Tìm hiểu", exact: true }).click();
      await expect(page.locator('#header-directory-learn a[href="/why-uniwork"]')).toBeVisible();
      await expect(page.locator('#header-directory-learn a[href="/changelog"]')).toHaveCount(0);
      await page.keyboard.press("Escape");
      await header.getByRole("button", { name: "Giải pháp", exact: true }).click();
      await expect(page.locator('#header-directory-solutions a[href="/enterprise"]')).toBeVisible();
      await page.keyboard.press("Escape");
      await toggle.click();
      await page.locator("#header-directory-products a[href='/features/meetings']").click();
      await expect(page).toHaveURL(/\/features\/meetings$/);
      await expect(page.locator("#header-directory-products")).toHaveCount(0);
    } else {
      const toggle = header.getByRole("button", { name: "Mở menu", exact: true });
      await toggle.click();
      await expect(page.locator("#landing-mobile-menu")).toBeVisible();
      await expect(page.locator("#landing-mobile-menu a[href='/register']")).toBeVisible();
      await page.screenshot({ path: resolve(dir, `opening-menu-${width}.png`), style: "nextjs-portal { visibility: hidden !important; }" });
      await page.locator('#landing-mobile-menu summary').filter({ hasText: "Sản phẩm" }).click();
      await expect(page.locator('#landing-mobile-menu a[href="/features/agents"]')).toHaveText("Nhân sự AI");
      await page.locator('#landing-mobile-menu summary').filter({ hasText: /^Office$/ }).click();
      await expect(page.locator('#landing-mobile-menu a[href="/office#office-business"]')).toBeVisible();
      await expect(page.locator("#landing-mobile-menu [data-office-personal]")).toContainText("Đang phát triển");
      await expect(page.locator("#landing-mobile-menu .header-office-links a")).toHaveCount(1);
      await page.locator('#landing-mobile-menu summary').filter({ hasText: "Tìm hiểu" }).click();
      await expect(page.locator('#landing-mobile-menu a[href="/changelog"]')).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(page.locator("#landing-mobile-menu")).toHaveCount(0);
    }
  });
}

for (const width of [1440, 390]) {
  test(`opening supports English and dark mode at ${width}px`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: "en", url: baseURL! }]);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await page.goto("/");
    await landingReady(page);
    await expect(page.locator("#landing-title")).toContainText("Every piece of work.");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await checkHeaderFits(page);
    await checkHeroBackground(page);
    for (const action of await page.locator(".landing-hero-actions a").all()) await expect(action).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const dir = resolve(import.meta.dirname, "../.impeccable/review");
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: resolve(dir, width === 1440 ? "opening-dark-en.png" : "opening-dark-en-mobile.png"), style: "nextjs-portal { visibility: hidden !important; }" });
  });
}

test("opening respects a changed reduced-motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await landingReady(page);
  await expect(page.locator("#landing-title")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator('.landing-hero-copy')).toHaveCSS('animation-name', 'none');
  await expect(page.locator(".landing-hero img")).toHaveCount(0);
});
