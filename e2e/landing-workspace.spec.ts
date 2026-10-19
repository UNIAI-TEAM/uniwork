import { selectWorkspaceFeature, openManualPreview } from "./landing-catalog-helpers";
import { expect, test } from "@playwright/test";
import { landingReady, gotoLanding } from "./landing-ready";
import vi from "../packages/core/i18n/locales/vi.json" with { type: "json" };

test("one workspace stage replaces the index and separate feature bands", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/");
  await landingReady(page);
  const stage = page.locator("#product-preview");
  await openManualPreview(page);
  await expect(page.locator(".product-index, .product-story-band, .meeting-section")).toHaveCount(0);
  await expect(stage.locator(".product-demo-menu")).toHaveCount(1);
  await expect(stage.locator(".workspace-group-button")).toHaveCount(0);
  for (const [name, key] of Object.entries({ "Công việc": "tasks", "Cuộc họp": "meetings", "Trò chuyện": "chat", "Email Hub": "email", "Hỏi UNI": "ask", "Việc của tôi": "today" })) {
    await selectWorkspaceFeature(page, key);
    await expect(stage.locator('.preview-main > [role="tabpanel"]:not([hidden])')).toHaveCount(1);
    await expect(stage.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("body")).not.toContainText(/landing\.[a-zA-Z][\w.]+/);
  }
});

test("feature deep links select the right panel and sidebar works with keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/#email");
  await landingReady(page);
  const stage = page.locator("#product-preview");
  await expect(stage.getByRole("tab", { name: "Email Hub", exact: true })).toHaveAttribute("aria-selected", "true");
  await openManualPreview(page);
  await expect(stage.locator(".manual-preview:not([hidden]) .product-email-preview")).toBeVisible();
  const email = stage.getByRole("tab", { name: "Email Hub", exact: true });
  await expect(email).toHaveAttribute("tabindex", "0");
  await email.focus();
  await page.keyboard.press("ArrowDown");
  await expect(stage.getByRole("tab", { name: "Cuộc họp", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(stage.locator(".product-playback")).toBeVisible();
  await expect(page).toHaveURL(/#hop$/);
});

test("local state survives view switches across the demo", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/");
  await landingReady(page);
  const stage = page.locator("#product-preview");
  await openManualPreview(page);
  await selectWorkspaceFeature(page, "chat");
  const message = stage.locator('.manual-preview:not([hidden]) .product-chat-messages article').first();
  await message.hover();
  await message.getByRole('button', { name: vi.chat.action_more, exact: true }).click();
  await page.getByRole('menuitem', { name: vi.chat.link.create_task, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: vi.common.create, exact: true }).click();
  await selectWorkspaceFeature(page, "tasks");
  await expect(stage.getByRole("tabpanel").locator(".product-task-open")).toHaveCount(9);
  await expect(stage.getByRole("tabpanel").locator(".product-task-open").filter({ hasText: "Cập nhật onboarding từ trao đổi của nhóm" })).toBeVisible();
  await selectWorkspaceFeature(page, "meetings");
  await stage.getByRole("button", { name: "Mic", exact: true }).click();
  await selectWorkspaceFeature(page, "email");
  await stage.locator('.manual-preview:not([hidden]) .product-email-list li').first().getByRole("button", { name: "Gắn sao", exact: true }).click();
  await selectWorkspaceFeature(page, "meetings");
  await expect(stage.getByRole("button", { name: "Mic", exact: true })).toHaveAttribute("aria-pressed", "true");
  await stage.locator('[data-feature="inbox"]').click();
  await stage.getByRole("button", { name: "Đánh dấu đã đọc", exact: true }).click();
  await expect(stage.locator(".product-demo-inbox [role=status]")).toHaveText("Không có thông báo nào đang chờ bạn trong workspace này.");
  await selectWorkspaceFeature(page, "tasks");
  await expect(stage.getByRole("tabpanel").locator(".product-task-open")).toHaveCount(9);
  await selectWorkspaceFeature(page, "meetings");
  await expect(stage.getByRole("button", { name: "Mic", exact: true })).toHaveAttribute("aria-pressed", "true");
  await selectWorkspaceFeature(page, "email");
  await expect(stage.locator('.manual-preview:not([hidden]) .product-email-list li').first().getByRole("button", { name: "Bỏ gắn sao", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("tablet product stage stays readable and Starter keeps one honest action", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/");
  await landingReady(page);
  const stage = page.locator("#product-preview");
  const selector = stage.locator(".product-demo-sidebar");
  const display = stage.locator(".workspace-display");
  const selectorBox = await selector.boundingBox();
  const displayBox = await display.boundingBox();
  expect(selectorBox).not.toBeNull();
  expect(displayBox).not.toBeNull();
  expect(displayBox!.x).toBeLessThanOrEqual(selectorBox!.x);
  expect(displayBox!.width).toBeGreaterThan(600);
  await selectWorkspaceFeature(page, "meetings");
  await expect(stage.getByRole("tab", { name: "Cuộc họp", exact: true })).toHaveAttribute("aria-selected", "true");

  const pricing = page.locator("#bang-gia");
  await expect(pricing.locator(".pricing-plan")).toContainText("Miễn phí");
  await expect(pricing.locator(".pricing-quotas li")).toHaveCount(8);
  await expect(pricing.locator(".pricing-plan a")).toHaveCount(1);
  await expect(pricing.locator(".pricing-quotas")).toContainText("chưa phải cam kết");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
