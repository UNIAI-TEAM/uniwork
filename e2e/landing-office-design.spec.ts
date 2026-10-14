import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";
import vi from "../packages/core/i18n/locales/vi.json" with { type: "json" };
import en from "../packages/core/i18n/locales/en.json" with { type: "json" };

const scenarios = [
  { width: 1306, theme: "light", locale: "en" },
  { width: 1440, theme: "dark", locale: "vi" },
  { width: 768, theme: "light", locale: "en" },
  { width: 390, theme: "light", locale: "vi" },
  { width: 390, theme: "dark", locale: "en" },
] as const;
const editors = ["docs", "sheets", "slides", "pdf", "html", "markdown"] as const;
const examples = ["draft", "data", "slides", "pdf", "html", "notes"] as const;

for (const scenario of scenarios) {
  test(`Office B has working themed editors at ${scenario.width}px ${scenario.theme} ${scenario.locale}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: scenario.locale, url: baseURL! }]);
    await page.setViewportSize({ width: scenario.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: scenario.theme });
    const configResponse = page.waitForResponse(response => response.url().includes("/api/v1/config") && response.request().method() === "GET");
    await page.goto("/office");
    const config = await (await configResponse).json();
    const published = [config.office_installers?.stable, config.office_installers?.beta, config.office_installers?.dev]
      .find((rows: { platform: string }[] | undefined) => rows?.length) ?? [];
    const hero = page.locator(".office-hero");
    const preview = hero.locator(".office-hero-preview");
    await expect(page.getByRole("tablist")).toHaveCount(1);
    await expect(page.locator("#office-title")).toBeVisible();
    const copyBounds = (await hero.locator(".office-hero-copy").boundingBox())!;
    const previewBounds = (await preview.boundingBox())!;
    expect(copyBounds.y + copyBounds.height).toBeLessThan(previewBounds.y);
    if (scenario.width >= 1100) {
      expect(previewBounds.width).toBeGreaterThan(scenario.width * .7);
      expect(Math.abs(previewBounds.x + previewBounds.width / 2 - scenario.width / 2)).toBeLessThan(2);
    }
    await expect(page.locator(".office-editions")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await auditText(page, ".office-world")).fails).toEqual([]);
    const dir = resolve(import.meta.dirname, "../.impeccable/review/office-distill");
    await mkdir(dir, { recursive: true });
    const image = preview.locator("img:visible");
    await expect(image).toHaveAttribute("data-theme", scenario.theme);
    await image.evaluate(async element => { await (element as HTMLImageElement).decode(); });
    await expect(page.locator(".office-world .office-shot img:visible")).toHaveCount(1);
    await page.screenshot({ path: resolve(dir, `${scenario.width}-${scenario.theme}-${scenario.locale}.png`), animations: "disabled", style: "nextjs-portal { visibility: hidden !important; }" });
    if (scenario.width >= 1100) {
      await page.screenshot({ path: resolve(dir, `full-${scenario.theme}.png`), fullPage: true, animations: "disabled", style: "nextjs-portal { visibility: hidden !important; }" });
      for (const section of ["office-editor-details", "office-ai-title", "office-download", "office-works-title"]) {
        const target = page.locator(`#${section}`);
        await (section.endsWith("title") ? target.locator("xpath=ancestor::section[1]") : target).screenshot({ path: resolve(dir, `${section}-${scenario.theme}.png`), animations: "disabled", style: ".site-header, nextjs-portal { visibility: hidden !important; }" });
      }
      await page.locator(".office-faq").screenshot({ path: resolve(dir, `faq-${scenario.theme}.png`), animations: "disabled", style: ".site-header, nextjs-portal { visibility: hidden !important; }" });
    }
    for (const [index, editor] of editors.entries()) {
      await preview.getByRole("tab").nth(index).click();
      await expect(preview.getByRole("tab").nth(index)).toHaveAttribute("aria-selected", "true");
      const activeImage = preview.locator("img:visible");
      await expect(activeImage).toHaveAttribute("data-theme", scenario.theme);
      await expect(activeImage).toHaveCSS("filter", "none");
      const source = await activeImage.getAttribute("src");
      expect(source).toContain(`${editor}.${scenario.locale}${scenario.theme === "dark" ? ".dark" : ""}.webp`);
      expect(await activeImage.evaluate(async element => { const img = element as HTMLImageElement; await img.decode(); return img.naturalWidth; })).toBe(2400);
      const imageBounds = (await activeImage.boundingBox())!;
      const frameBounds = (await preview.locator(".office-shot-frame").boundingBox())!;
      expect(imageBounds.y + imageBounds.height).toBeLessThanOrEqual(frameBounds.y + frameBounds.height + 1);
      const messages = scenario.locale === "vi" ? vi : en;
      await expect(page.locator("#office-editor-summary-title")).toHaveText(messages.landing.office.editors[editor].title);
      const example = page.locator(".office-editor-example:visible");
      await expect(example).toHaveAttribute("data-office-example", examples[index]);
      await expect(example).toContainText(messages.landing.office.tasks[examples[index]].description);
      await expect(page.locator("#office-editors").getByRole("tabpanel")).toContainText(messages.landing.office.tasks[examples[index]].description);
      await expect(page.locator(".office-world .office-shot img:visible")).toHaveCount(1);
    }
    await preview.getByRole("tab").nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await expect(preview.getByRole("tab").nth(1)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(preview.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".office-tasks, .office-task-link, .office-trust")).toHaveCount(0);
    const messages = scenario.locale === "vi" ? vi : en;
    const connection = page.locator(".office-connection");
    await expect(connection.locator(".office-connection-points li")).toHaveCount(3);
    await connection.getByRole("button", { name: messages.landing.office.connection.details.ai, exact: true }).click();
    const aiDetails = connection.getByRole("region", { name: messages.landing.office.connection.details.ai, exact: true });
    await expect(aiDetails).toContainText(messages.landing.office.ai.account.description);
    await expect(aiDetails).toContainText(messages.landing.office.faq.a4);
    await connection.getByRole("button", { name: messages.landing.office.connection.details.files, exact: true }).click();
    await expect(connection.getByRole("region", { name: messages.landing.office.connection.details.files, exact: true })).toContainText(messages.landing.office.ai.files.description);
    await connection.screenshot({ path: resolve(dir, `connection-expanded-${scenario.width}-${scenario.theme}.png`), animations: "disabled", style: ".site-header, nextjs-portal { visibility: hidden !important; }" });
    expect((await auditText(page, ".office-connection")).fails).toEqual([]);
    await hero.locator(".office-trial-action").click();
    await expect(page).toHaveURL(/#office-download$/);
    await expect(page.locator("#office-download-title")).toBeInViewport();
    await expect(page.locator("#office-download a[download]")).toHaveCount(published.length);
    if (published.length === 0) await expect(page.locator("#office-download .office-unavailable")).toBeVisible();
    const closing = page.locator(".final-compact-demo");
    await expect(closing).toHaveText(scenario.locale === "vi" ? vi.landing.office.hero.explore : en.landing.office.hero.explore);
    await closing.click();
    await expect(page).toHaveURL(/#office-editors$/);
    await expect(preview).toBeInViewport();
    await hero.locator('a[href="/request-demo"]').click();
    await expect(page).toHaveURL(/\/request-demo$/);
    await expect(page.locator("h1")).toBeVisible();
  });
}

test("Office images follow an explicit theme change", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/office");
  await expect(page.locator(".office-hero-preview img:visible")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Giao diện", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Tối", exact: true }).click();
  await expect(page.locator(".office-hero-preview img:visible")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Giao diện", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Sáng", exact: true }).click();
  await expect(page.locator(".office-hero-preview img:visible")).toHaveAttribute("data-theme", "light");
});
