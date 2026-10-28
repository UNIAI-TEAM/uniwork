import { selectWorkspaceFeature, openManualPreview, openMeetingList } from "./landing-catalog-helpers";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";
import { landingReady, gotoLanding } from "./landing-ready";
import vi from "../packages/core/i18n/locales/vi.json" with { type: "json" };

test("studio demo switches views and tabs locally, with keyboard support", async ({ page }) => {
  await gotoLanding(page, "/");
  await landingReady(page);
  await page.waitForLoadState("networkidle");
  const preview = page.locator("#product-preview");
  await openManualPreview(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/api\/v1\/.*(tasks|messages|ai\/ask)/.test(request.url())) {
      writes.push(request.url());
    }
  });
  await expect(preview.locator(".product-demo-toolbar").getByText("Bản minh họa", { exact: true })).toBeVisible();
  const panel = preview.locator(".preview-main > [role=tabpanel]:not([hidden])");
  const board = panel.locator(".product-task-board");
  await expect(board).toHaveAttribute("data-view", "board");
  // The view menu's trigger is named after the selected view; "Danh sách" is a menu item.
  await panel.getByRole("button", { name: vi.landing.studio.board, exact: true }).click();
  await page.getByRole("menuitem", { name: vi.landing.studio.list, exact: true }).click();
  await expect(board).toHaveAttribute("data-view", "list");
  await expect(panel.getByRole("button", { name: vi.landing.studio.list, exact: true })).toBeVisible();
  await expect(panel.locator(".product-task-list-row").first()).toBeVisible();
  const launchTitle = vi.landing.productDemo.board.tasks.launch;
  await panel.getByRole("button", { name: new RegExp(launchTitle) }).click();
  await expect(panel.locator(".product-task-details")).toContainText(launchTitle);
  await selectWorkspaceFeature(page, "chat");
  const chatLog = panel.getByRole("log", { name: vi.chat.title });
  await expect(chatLog).toContainText(vi.landing.studio.message1);
  await expect(chatLog).toContainText(vi.landing.studio.message2);
  // The vertical menu is a tablist: three ArrowUp steps walk Chat -> Documents -> Meetings -> Email Hub.
  const chatTab = preview.getByRole("tab", { name: vi.nav.chat, exact: true });
  const emailTab = preview.getByRole("tab", { name: vi.nav.email, exact: true });
  await chatTab.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(emailTab).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(emailTab).toHaveAttribute("aria-selected", "true");
  await selectWorkspaceFeature(page, "ask");
  await expect(preview.getByRole("tab", { name: vi.landing.studio.askTab, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText(vi.ai.empty_description, { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: vi.ai.suggestion_overdue, exact: true }).click();
  await expect(panel.getByRole("list", { name: vi.ai.sources, exact: true })).toContainText(vi.landing.productDemo.board.tasks.design);
  expect(writes).toEqual([]);
});

test("mobile menu closes with Escape and returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLanding(page, "/");
  await landingReady(page);
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
    await gotoLanding(page, "/");
    await landingReady(page);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("html")).toHaveAttribute("lang", scenario.locale);
    await page.evaluate((mode) => document.documentElement.classList.toggle("dark", mode === "dark"), scenario.theme);
    await expect(page.locator("h1")).toContainText(scenario.locale === "vi" ? "Mọi công việc." : "Every piece of work.");
    await expect(page.locator("body")).not.toContainText(/landing\.[a-zA-Z][\w.]+/);
    await expect(page.locator('.landing-hero')).toBeVisible();
    await page.locator('[data-scene="character"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-scene="character"]')).toBeVisible();
    await selectWorkspaceFeature(page, "meetings");
    await openMeetingList(page);
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
      await page.locator('.landing-hero').screenshot({ path: resolve(dir, `${scenario.name}-core.png`), style: sectionChrome });
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
