import { selectWorkspaceFeature, openManualPreview } from "./landing-catalog-helpers";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";

test("studio demo switches views and tabs locally, with keyboard support", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const preview = page.locator("#product-preview");
  await openManualPreview(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/api\/v1\/.*(tasks|messages|ai\/ask)/.test(request.url())) {
      writes.push(request.url());
    }
  });
  await expect(preview.locator(".preview-topbar").getByText("Bản minh họa", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "Danh sách", exact: true }).click();
  await expect(preview.getByRole("button", { name: "Danh sách", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(preview.locator(".preview-task-list")).toBeVisible();
  await preview.getByRole("button", { name: /Thống nhất phạm vi ra mắt/ }).click();
  await expect(preview.locator(".preview-selection")).toContainText("Thống nhất phạm vi ra mắt");
  await selectWorkspaceFeature(page, "chat");
  await expect(preview.getByRole("tabpanel", { name: "Trao đổi", exact: true }).locator(".preview-message")).toHaveCount(2);
  await preview.getByRole("tab", { name: "Trao đổi", exact: true }).press("ArrowDown");
  await expect(preview.getByRole("tab", { name: "Email Hub", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(preview.getByRole("tab", { name: "Email Hub", exact: true })).toHaveAttribute("aria-selected", "true");
  await selectWorkspaceFeature(page, "ask");
  await expect(preview.getByRole("tab", { name: "Hỏi UNI", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(preview.getByText("Dựa trên các công việc bạn có quyền xem trong workspace", { exact: false })).toBeVisible();
  await expect(preview.locator(".preview-source")).toContainText("Nguồn");
  expect(writes).toEqual([]);
});

test("mobile menu closes with Escape and returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const trigger = page.getByRole("banner").getByRole("button", { name: "Mở menu", exact: true });
  await trigger.click();
  await expect(page.locator("#landing-mobile-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#landing-mobile-menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const scenario of [
  { name: "desktop", width: 1440, height: 900, locale: "vi", theme: "light" },
  { name: "mobile", width: 390, height: 844, locale: "vi", theme: "light" },
  { name: "user-1294", width: 1294, height: 584, locale: "vi", theme: "light" },
  { name: "desktop-dark-en", width: 1440, height: 900, locale: "en", theme: "dark" },
  { name: "mobile-dark-en", width: 390, height: 844, locale: "en", theme: "dark" },
]) {
  test(`studio responsive, assets and contrast: ${scenario.name}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: scenario.locale, url: baseURL! }]);
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: scenario.theme as "light" | "dark" });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("html")).toHaveAttribute("lang", scenario.locale);
    await page.evaluate((mode) => document.documentElement.classList.toggle("dark", mode === "dark"), scenario.theme);
    await expect(page.locator("h1")).toContainText(scenario.locale === "vi" ? "Cả nhóm." : "Your team.");
    await expect(page.locator("body")).not.toContainText(/landing\.[a-zA-Z][\w.]+/);
    await expect(page.locator('[data-scene="core"]')).toBeVisible();
    await page.locator('[data-scene="character"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-scene="character"]')).toBeVisible();
    await selectWorkspaceFeature(page, "meetings");
    await page.locator(".meeting-follow-up [data-slot=accordion-trigger]").click();
    const video = page.locator(".workflow-film video");
    await video.scrollIntoViewIfNeeded();
    await expect(video).toHaveAttribute("poster", "/landing/motion/workflow-film.webp");
    await video.evaluate((element: HTMLVideoElement) => element.load());
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const contrast = await auditText(page);
    expect(contrast.fails).toEqual([]);
    if (process.env.LANDING_CAPTURE === "1") {
      const dir = resolve(import.meta.dirname, "../.impeccable/review");
      await mkdir(dir, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      const cleanChrome = "nextjs-portal { display: none !important; }";
      // Fixed chrome is kept in full-page/viewport evidence but excluded from
      // element crops: tall crops would otherwise stamp it across the section.
      const sectionChrome = `${cleanChrome} .site-header, .landing-skip { visibility: hidden !important; }`;
      await page.screenshot({ path: resolve(dir, `${scenario.name}.png`), fullPage: true, style: cleanChrome });
      await page.screenshot({ path: resolve(dir, `${scenario.name}-hero.png`), style: cleanChrome });
      await page.locator(".trust-band").screenshot({ path: resolve(dir, `${scenario.name}-trust-band.png`), style: sectionChrome });
      await page.locator('[data-scene="core"]').screenshot({ path: resolve(dir, `${scenario.name}-core.png`), style: sectionChrome });
      for (const id of ["platform", "nhan-su-ai", "security", "lo-trinh", "work-products"]) {
        const section = page.locator(`#${id}`);
        await section.scrollIntoViewIfNeeded();
        // Section entrances start when the crop scrolls them into view. Wait
        // for that authored state so evidence never captures the pre-entry frame.
        await page.waitForTimeout(900);
        await section.screenshot({ path: resolve(dir, `${scenario.name}-${id}.png`), style: sectionChrome });
      }
      const faq = page.locator(".landing-faq");
      await faq.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await faq.screenshot({ path: resolve(dir, `${scenario.name}-faq.png`), style: sectionChrome });
      if (scenario.name === "desktop") {
        for (const id of ["platform", "nhan-su-ai", "giai-phap", "security", "bang-gia", "lien-he"]) {
          await page.locator(`#${id}`).screenshot({ path: resolve(dir, `section-${id}.png`), style: sectionChrome });
        }
      }
      await page.locator("#work-products [data-slot=accordion-trigger]").click();
      await page.locator("#lo-trinh").screenshot({ path: resolve(dir, `${scenario.name}-roadmap-expanded.png`), style: sectionChrome });
    }
  });
}
