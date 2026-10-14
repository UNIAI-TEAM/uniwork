import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";
import vi from "../packages/core/i18n/locales/vi.json" with { type: "json" };
import en from "../packages/core/i18n/locales/en.json" with { type: "json" };

for (const sample of [{ width: 1440, locale: "vi", theme: "light" }, { width: 390, locale: "en", theme: "dark" }] as const) {
  test(`introduction content is consolidated ${sample.width}-${sample.locale}-${sample.theme}`, async ({ page, context, baseURL }) => {
    test.setTimeout(180000);
    await context.addCookies([{ name: "uniwork-locale", value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ colorScheme: sample.theme, reducedMotion: "reduce" });
    const messages = sample.locale === "vi" ? vi : en;
    const dir = resolve(import.meta.dirname, "../.impeccable/review/marketing-distill");
    await mkdir(dir, { recursive: true });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const route of ["features/tasks", "enterprise", "pricing", "why-uniwork", "learn", "solutions/operations"]) {
      await page.goto(`/${route}`);
      await expect(page.locator("h1")).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), route).toBeLessThanOrEqual(1);
      const suffix = `${route.replaceAll("/", "-")}-${sample.width}-${sample.theme}`;
      let section = page.locator(".chapter-hero");
      if (route === "features/tasks") {
        section = page.locator(".feature-examples");
        await expect(section.getByRole("tab")).toHaveCount(3);
        for (const [index, copy] of messages.landing.productPages.features.tasks.points.entries()) {
          await expect(section.getByRole("tab").nth(index)).toContainText(copy);
          await section.getByRole("tab").nth(index).click();
          await expect(section.getByRole("tabpanel").locator(".feature-art")).toHaveAttribute("data-variant", String(index + 1));
        }
        await section.getByRole("tab").first().click();
        await expect(section.locator(".marketing-scope")).toHaveCount(0);
        await expect(page.locator(".feature-page-copy .marketing-scope")).toBeAttached();
        await expect(page.locator(".feature-demo-heading p")).toBeAttached();
      }
      if (route === "enterprise") {
        section = page.locator("#governance");
        await expect(section.locator("article")).toHaveCount(3);
        await expect(section.locator("table")).toHaveCount(0);
        for (const [index, row] of messages.landing.chapters.enterprise.rows.entries()) {
          await expect(section.locator("article").nth(index)).toContainText(row.confirm);
          await expect(section.locator("article").nth(index)).toContainText(messages.landing.chapters.enterprise.exampleDescriptions[index]);
        }
        await expect(section.locator("article").nth(1)).toContainText(messages.landing.productPages.enterprisePoints[1]);
        await page.locator('.marketing-actions a[href="#governance"]').click();
        await expect(page.locator("#governance-title")).toBeInViewport();
      }
      if (route === "pricing") {
        section = page.locator("#plan-offer");
        await expect(page.locator(".pricing-introduction")).toHaveCount(0);
        await expect(section.locator(".pricing-offer")).toBeVisible();
        await expect(section.locator(".pricing-quotas li")).toHaveCount(8);
        await expect(page.locator(".chapter-table tbody tr")).toHaveCount(2);
        await expect(page.locator("main p").filter({ hasText: messages.landing.pricing.status })).toHaveCount(1);
      }
      if (route === "why-uniwork") {
        section = page.locator(".final-compact-section");
        await expect(page.locator(".why-decision")).toHaveCount(0);
        await expect(section.locator("h2")).toHaveText(messages.landing.why.redesign.decisionTitle);
        await expect(section.locator(".final-compact-copy p")).toHaveText(messages.landing.why.redesign.decisionDescription);
        await expect(section.locator(".final-compact-demo")).toHaveText(messages.landing.why.redesign.tryAction);
        await expect(section.locator(".final-compact-demo")).toHaveAttribute("href", "/features/tasks");
        await expect(page.locator(".why-proof-figure")).toHaveCount(3);
        await expect(page.locator(".why-sources a")).toHaveCount(2);
      }
      if (["learn", "solutions/operations"].includes(route)) {
        await expect(page.locator(".chapter-hero .feature-art")).toHaveAttribute("data-variant", "0");
        await expect(page.locator(".chapter-row .feature-art[data-variant='2']").first()).toBeAttached();
      }
      expect((await auditText(page, route === "why-uniwork" ? ".why-page, .final-compact-section" : ".chapter-world > :not(.feature-demo)")).fails, route).toEqual([]);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: resolve(dir, `full-${suffix}.png`), fullPage: true, animations: "disabled", style: "nextjs-portal {visibility:hidden !important}" });
      await section.screenshot({ path: resolve(dir, `section-${suffix}.png`), animations: "disabled", style: ".site-header, nextjs-portal {visibility:hidden !important}" });
    }
    await page.goto("/");
    await expect(page.locator(".pricing-introduction #landing-pricing-title")).toHaveText(messages.landing.pricing.title);
    expect(errors).toEqual([]);
  });
}
