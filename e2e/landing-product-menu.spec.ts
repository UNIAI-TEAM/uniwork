import { expect, test } from "@playwright/test";
import { gotoLanding, landingReady } from "./landing-ready";
import { openManualPreview } from "./landing-catalog-helpers";
import vi from "../packages/core/i18n/locales/vi.json" with { type: "json" };

for (const width of [1440, 390]) {
  test(`the product menu operates the landing demo at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoLanding(page, "/#tong-quan");
    await landingReady(page);
    const stage = page.locator("#product-preview");
    await expect(stage.locator(".workspace-selector")).toHaveCount(0);
    await expect(stage.getByRole("heading", { name: /Chào buổi sáng/ })).toBeVisible();
    await stage.screenshot({ path: `.impeccable/review/product-menu-home-${width}.png`, animations: "disabled" });
    const panel = stage.locator('.preview-main > [role="tabpanel"]:not([hidden])');
    const openMenu = async () => {
      if (width < 768) await stage.locator('[data-action="toggle-demo-menu"]').click();
    };
    await openMenu();
    await stage.locator('[data-feature="tasks"]').click();
    await openManualPreview(page);
    await expect(panel.locator(".product-task-columns")).toBeVisible();
    await panel.locator('[data-demo-task="design"]').click();
    await panel.locator('[data-action="complete-task"]').click();
    await expect(panel.locator('[data-action="complete-task"]')).toContainText("Mở lại");
    await openMenu();
    await stage.locator('[data-feature="chat"]').click();
    await openManualPreview(page);
    if (width < 768) await panel.locator('.product-chat-sidebar').getByRole('button', { name: /UNICOM/ }).click();
    await stage.getByRole("textbox", { name: vi.landing.demo.messagePlaceholder }).fill("Kiểm tra bản demo");
    await stage.getByRole("button", { name: "Gửi tin nhắn" }).click();
    await expect(stage.getByRole("log")).toContainText("Kiểm tra bản demo");
    await openMenu();
    await stage.locator('[data-feature="documents"]').click();
    await panel.getByRole('row').filter({ hasText: 'Design guidelines' }).getByRole('button').first().click();
    await expect(panel.locator(".product-documents-editor h2")).toContainText("Design guidelines");
    await stage.screenshot({ path: `.impeccable/review/product-menu-documents-${width}.png`, animations: "disabled" });
    await openMenu();
    await stage.locator('[data-feature="workflows"]').click();
    if (width > 900) await expect(stage.locator('[data-lovable-screen="workflows"]')).toBeVisible();
    else await expect(stage.locator(".mobile-feature-story")).toBeVisible();
    await expect(stage.locator(".product-demo-tools")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await stage.screenshot({ path: `.impeccable/review/product-menu-${width}.png`, animations: "disabled" });
  });
}

test("the marketing product menu opens a demo directly", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoLanding(page, "/");
  await landingReady(page);
  await page.locator(".header-directory-toggle").first().click();
  await page.locator('#header-directory-products a[href$="#tai-lieu"]').click();
  await expect(page.locator('#product-preview [data-feature="documents"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".product-documents-library")).toBeVisible();
});

test("create, search and save stay inside the demo across view switches", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoLanding(page, "/#tong-quan");
  await landingReady(page);
  const stage = page.locator("#product-preview");
  const panel = stage.locator('.preview-main > [role="tabpanel"]:not([hidden])');
  await panel.getByRole("button", { name: /^Tạo việc/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Tiêu đề" }).fill("Chuẩn bị bản demo");
  await dialog.getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(panel.locator(".product-task-open")).toHaveCount(9);
  await expect(panel).toContainText("Chuẩn bị bản demo");
  await stage.locator('[data-feature="dashboard"]').click();
  await panel.getByRole("button", { name: /^Lên lịch họp/ }).click();
  await dialog.getByRole("textbox", { name: "Tiêu đề" }).fill("Review giao diện");
  await dialog.getByLabel("Bắt đầu", { exact: true }).fill("2026-10-20T15:30");
  await dialog.getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(panel.locator(".product-demo-created-meetings")).toHaveText("Review giao diện · 2026-10-20 · 15:30");
  const search = stage.getByRole("searchbox", { name: "Tìm trong sản phẩm…" });
  await search.fill("tài liệu");
  await search.press("Enter");
  await expect(stage.locator('[data-feature="documents"]')).toHaveAttribute("aria-selected", "true");
  await panel.getByRole('region', { name: vi.documents.home.quick_create.label }).getByRole('button').first().click();
  await panel.locator('[contenteditable=true]').fill("Nội dung đã chỉnh trong demo");
  await panel.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(panel).toContainText("Nội dung đã chỉnh trong demo");
  await stage.locator('[data-feature="tasks"]').click();
  await openManualPreview(page);
  await expect(panel.locator(".product-task-open")).toHaveCount(9);
  await expect(panel).toContainText("Chuẩn bị bản demo");
  await stage.locator('[data-feature="documents"]').click();
  await expect(panel).toContainText("Nội dung đã chỉnh trong demo");
  await expect(stage).not.toContainText(/(?:home|landing|ai)\.[a-z][\w.]+/);
});

for (const sample of [{ width: 1440, locale: "en" }, { width: 390, locale: "vi" }] as const) {
  test(`the app shell stays readable in dark mode ${sample.width}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await gotoLanding(page, "/#tong-quan");
    await landingReady(page);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const stage = page.locator("#product-preview");
    await expect(stage.getByRole("heading", { level: 2 })).toHaveText(sample.locale === "en" ? "Good morning, Đạt" : "Chào buổi sáng, Đạt");
    await expect(stage).not.toContainText(/(?:home|landing|ai)\.[a-z][\w.]+/);
    const contrast = await stage.evaluate(node => {
      const values = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
      const luminance = (color: string) => { const [r, g, b] = values(color); return .2126 * r! + .7152 * g! + .0722 * b!; };
      const background = luminance(getComputedStyle(node.querySelector(".product-demo-app")!).backgroundColor);
      const foreground = luminance(getComputedStyle(node.querySelector(".product-demo-home > p")!).color);
      return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await stage.screenshot({ path: `.impeccable/review/product-menu-dark-${sample.width}.png`, animations: "disabled" });
  });
}
