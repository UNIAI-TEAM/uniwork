import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";

const samples = [
  { width: 1536, locale: "en", theme: "light" },
  { width: 1280, locale: "vi", theme: "dark" },
  { width: 768, locale: "vi", theme: "light" },
  { width: 390, locale: "en", theme: "dark" },
  { width: 390, locale: "vi", theme: "light" },
  { width: 320, locale: "vi", theme: "dark" },
] as const;

for (const { width, locale, theme } of samples) {
  test(`trust chapter stays compact and usable: ${width} ${locale} ${theme}`, async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.addCookies([{ name: "uniwork-locale", value: locale, url: baseURL! }]);
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    if (width === 1280) {
      // Client navigation retains global styles from the feature route.
      await page.goto("/features/tasks");
      await page.locator('.site-header a[href="/"]').first().click();
    } else {
      await page.goto("/");
    }
    const chapter = page.locator(".landing-trust-story");
    await expect(chapter).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await chapter.scrollIntoViewIfNeeded();
    const copy = chapter.locator(".security-copy");
    const record = chapter.locator(".security-record");
    const copyBox = (await copy.boundingBox())!;
    const recordBox = (await record.boundingBox())!;
    if (width > 900) {
      expect(recordBox.x).toBeGreaterThan(copyBox.x + copyBox.width);
      expect(Math.abs(recordBox.y - copyBox.y)).toBeLessThan(16);
      expect((await chapter.boundingBox())!.height).toBeLessThan(700);
      expect((await chapter.locator(".trust-band").boundingBox())!.height).toBeLessThan(100);
    } else {
      expect(recordBox.y).toBeGreaterThan(copyBox.y + copyBox.height);
    }
    await expect(chapter.locator(".trust-models li")).toHaveCount(3);
    await expect(chapter.locator(".trust-models button, .trust-models a")).toHaveCount(0);
    expect(await chapter.locator(".trust-models ul").evaluate(element => getComputedStyle(element, "::before").content)).toBe("none");
    await expect(chapter.locator(".market-layout a")).toHaveAttribute("href", "/why-uniwork");
    await expect(chapter.locator(".security-explore")).toHaveAttribute("href", "#nhat-ky");
    const dir = resolve(import.meta.dirname, "../.impeccable/review");
    await mkdir(dir, { recursive: true });
    const captureStyle = ".site-header, nextjs-portal { visibility: hidden !important; }";
    await chapter.screenshot({ path: resolve(dir, `trust-${width}-${locale}-${theme}.png`), style: captureStyle });

    for (const trigger of await chapter.locator(".security-mechanism button").all()) {
      expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(trigger).toBeFocused();
      // The shared accordion opens one group at a time; all six facts stay reachable.
      await expect(chapter.locator(".security-detail h4:visible")).toHaveCount(2);
      await expect(chapter.locator(".security-detail p:visible")).toHaveCount(2);
      expect((await copy.boundingBox())!.width).toBeCloseTo(copyBox.width, 0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const contentFits = await chapter.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>("h2,h3,h4,p,dd,li,button")).every(node => node.scrollWidth <= node.clientWidth + 1));
    expect(contentFits).toBe(true);
    const isolation = await page.addStyleTag({ content: ".landing-site { visibility: hidden; } .landing-trust-story { visibility: visible; }" });
    const contrast = await auditText(page);
    expect(contrast.checked).toBeGreaterThan(25);
    expect(contrast.fails).toEqual([]);
    await isolation.evaluate(node => node.remove());
    if (width === 320) await chapter.screenshot({ path: resolve(dir, "trust-320-expanded.png"), style: captureStyle });
    expect(errors).toEqual([]);
  });
}
