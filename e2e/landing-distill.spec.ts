import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  for (const locale of ["en", "vi"] as const) {
    test(`compact landing keeps content and actions at ${width}px: ${locale}`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "uniwork-locale", value: locale, url: baseURL! }]);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: locale === "en" ? "dark" : "light" });
      await page.goto("/");
      await expect(page.locator('.scene-canvas')).toHaveAttribute('data-rendered', 'true', { timeout: 20000 });
      await expect(page.locator('.scene-canvas')).toHaveCSS('height', width < 768 ? '200px' : '230px');
      await page.evaluate(() => document.fonts.ready);
      const hero = page.locator('.landing-hero');
      expect((await hero.boundingBox())!.height).toBeLessThan(width < 768 ? 700 : 650);
      await expect(page.locator('#landing-title br')).toHaveCount(0);
      await expect(page.locator('.hero-context small, .landing-hero-note')).toHaveCount(0);
      await expect(hero.getByRole('link')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const dir = resolve(import.meta.dirname, '../.impeccable/review');
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: resolve(dir, `distill-${locale}-${width}-hero.png`) });

      const security = page.locator('#security');
      await security.scrollIntoViewIfNeeded();
      await expect(security.locator('.security-mechanism')).toHaveCount(3);
      if (width >= 768) expect((await security.boundingBox())!.height).toBeLessThan(650);
      const captureStyle = '.site-header, nextjs-portal { visibility: hidden !important; }';
      await security.screenshot({ path: resolve(dir, `distill-${locale}-${width}-security.png`), style: captureStyle });
      const copyWidth = (await security.locator('.security-copy').boundingBox())!.width;
      for (const mechanism of await security.locator('.security-mechanism').all()) {
        const trigger = mechanism.getByRole('button');
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await expect(mechanism.locator('.security-detail h4')).toHaveCount(2);
        await expect(mechanism.locator('.security-detail p')).toHaveCount(2);
        await expect(mechanism.locator('.security-detail')).toBeVisible();
        expect((await security.locator('.security-copy').boundingBox())!.width).toBeCloseTo(copyWidth, 0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.keyboard.press('Enter');
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      }
      await expect(security.locator('.security-explore')).toHaveAttribute('href', '#nhat-ky');
      const closing = page.locator('.final-section');
      await closing.scrollIntoViewIfNeeded();
      expect((await closing.boundingBox())!.height).toBeLessThan(width < 768 ? 700 : 880);
      await expect(closing.locator(".final-showcase .lovable-canvas")).toBeVisible();
      await expect(closing.getByRole('link')).toHaveCount(1);
      await expect(closing.getByRole('link')).toHaveAttribute('href', '/register');
      await expect(closing.locator('.studio-description, .final-note')).toHaveCount(0);
      await closing.screenshot({ path: resolve(dir, `distill-${locale}-${width}-closing.png`), style: captureStyle });
    });
  }
}
