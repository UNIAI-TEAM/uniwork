import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [1440, 1280, 768, 390]) {
  test(`opening stays readable with working navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator(".header-shell")).toHaveCSS("display", "flex");
    await expect(page.locator(".landing-hero-stage")).toHaveCSS("display", "flex");
    await expect(page.locator(".landing-hero-copy")).toHaveCSS("text-align", "center");
    await expect(page.locator(".landing-hero-actions")).toHaveCSS("justify-content", "center");
    await expect(page.locator('.scene-canvas')).toHaveAttribute('data-rendered', 'true', { timeout: 20000 });
    await expect(page.locator(".landing-hero-actions a")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator(".landing-hero, .site-header").allTextContents()).join(" ")).not.toContain("landing.");
    const motionButton = await page.locator('.scene-core .scene-motion-toggle').boundingBox();
    for (const context of await page.locator('.hero-context').all()) {
      const box = await context.boundingBox();
      const separate = box!.x + box!.width <= motionButton!.x || box!.x >= motionButton!.x + motionButton!.width || box!.y + box!.height <= motionButton!.y || box!.y >= motionButton!.y + motionButton!.height;
      expect(separate).toBe(true);
    }
    await expect(page.locator(".hero-scene-footer, .hero-scene-caption")).toHaveCount(0);
    const dir = resolve(import.meta.dirname, "../.impeccable/review");
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: resolve(dir, `opening-${width}.png`), style: "nextjs-portal { visibility: hidden !important; }" });
    const header = page.getByRole("banner");
    if (width >= 1200) {
      const toggle = header.getByRole("button", { name: "Sản phẩm", exact: true });
      await toggle.click();
      await expect(page.locator("#header-directory-products")).toBeVisible();
      await page.locator('#header-directory-products a[href="/features/dashboard"]').focus();
      await expect(page.locator('#header-directory-products a[href="/features/dashboard"]')).toBeFocused();
      await page.screenshot({ path: resolve(dir, `opening-menu-${width}.png`), style: "nextjs-portal { visibility: hidden !important; }" });
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(page.locator("#header-directory-products")).toHaveCount(0);
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
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(page.locator("#landing-mobile-menu")).toHaveCount(0);
    }
  });
}

test("opening supports English and dark mode", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "uniwork-locale", value: "en", url: baseURL! }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator(".scene-canvas")).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  await expect(page.getByRole("banner").getByRole("button", { name: "Product", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const dir = resolve(import.meta.dirname, "../.impeccable/review");
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, "opening-dark-en.png"), style: "nextjs-portal { visibility: hidden !important; }" });
});

test("opening motion can be paused and honors a changed reduced-motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const core = page.locator('.scene-core');
  await expect(core.locator('.scene-canvas')).toHaveAttribute('data-rendered', 'true', { timeout: 20000 });
  await expect(core).toHaveAttribute('data-motion', 'playing');
  await core.getByRole('button').click();
  await expect(core).toHaveAttribute('data-motion', 'paused');
  await core.getByRole('button').click();
  await expect(core).toHaveAttribute('data-motion', 'playing');
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(core).toHaveAttribute('data-motion', 'paused');
  await expect(page.locator('.landing-hero-copy')).toHaveCSS('animation-name', 'none');
});
