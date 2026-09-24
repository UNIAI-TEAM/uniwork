import { selectWorkspaceFeature, openManualPreview } from "./landing-catalog-helpers";
import { expect, test } from "@playwright/test";

test("one workspace stage replaces the index and separate feature bands", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const stage = page.locator("#product-preview");
  await openManualPreview(page);
  await expect(page.locator(".product-index, .product-story-band, .meeting-section")).toHaveCount(0);
  await expect(stage.getByRole("tablist")).toHaveCount(1);
  await expect(stage.locator(".workspace-group-button")).toHaveCount(6);
  for (const [name, key] of Object.entries({ "Công việc": "tasks", "Họp trực tuyến": "meetings", "Trao đổi": "chat", "Email Hub": "email", "Hỏi UNI": "ask", "Hôm nay": "today" })) {
    await selectWorkspaceFeature(page, key);
    await expect(stage.getByRole("tabpanel")).toHaveCount(1);
    await expect(stage.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("body")).not.toContainText(/landing\.[a-zA-Z][\w.]+/);
  }
});

test("feature deep links select the right panel and sidebar works with keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#email");
  const stage = page.locator("#product-preview");
  await openManualPreview(page);
  await expect(stage.getByRole("tab", { name: "Email Hub", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(stage.locator(".email-demo")).toBeVisible();
  const email = stage.getByRole("tab", { name: "Email Hub", exact: true });
  await email.focus();
  await page.keyboard.press("ArrowDown");
  await expect(stage.getByRole("tab", { name: "Họp trực tuyến", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(stage.locator(".meeting-room")).toBeVisible();
  await expect(page).toHaveURL(/#hop$/);
});

test("local state survives view switches and the global reset clears every demo", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const stage = page.locator("#product-preview");
  await openManualPreview(page);
  await selectWorkspaceFeature(page, "chat");
  await stage.getByRole("button", { name: "Thử tạo công việc", exact: true }).click();
  await selectWorkspaceFeature(page, "tasks");
  await expect(stage.locator(".preview-task")).toHaveCount(5);
  await expect(stage.locator(".preview-task").filter({ hasText: "Cập nhật onboarding từ trao đổi của nhóm" })).toBeVisible();
  await selectWorkspaceFeature(page, "meetings");
  await stage.getByRole("button", { name: "Mic", exact: true }).click();
  await selectWorkspaceFeature(page, "email");
  await stage.getByRole("button", { name: "Gắn sao", exact: true }).click();
  await selectWorkspaceFeature(page, "meetings");
  await expect(stage.getByRole("button", { name: "Mic", exact: true })).toHaveAttribute("aria-pressed", "true");
  await selectWorkspaceFeature(page, "today");
  await stage.getByRole("button", { name: "Đánh dấu đã đọc", exact: true }).click();
  await expect(stage.locator(".today-inbox [role=status]")).toHaveText("Đã đọc tất cả");
  await stage.locator("[data-action='reset-preview']").click();
  await expect(stage.locator(".today-inbox [role=status]")).toHaveText("2 chưa đọc");
  await selectWorkspaceFeature(page, "tasks");
  await expect(stage.locator(".preview-task")).toHaveCount(4);
  await selectWorkspaceFeature(page, "meetings");
  await expect(stage.getByRole("button", { name: "Mic", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("tablet product stage stays readable and Starter keeps one honest action", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const stage = page.locator("#product-preview");
  const selector = stage.locator(".workspace-selector");
  const display = stage.locator(".workspace-display");
  const selectorBox = await selector.boundingBox();
  const displayBox = await display.boundingBox();
  expect(selectorBox).not.toBeNull();
  expect(displayBox).not.toBeNull();
  expect(displayBox!.y).toBeGreaterThan(selectorBox!.y);
  expect(displayBox!.width).toBeGreaterThan(600);
  await selectWorkspaceFeature(page, "meetings");
  await expect(stage.getByRole("tab", { name: "Họp trực tuyến", exact: true })).toHaveAttribute("aria-selected", "true");

  const pricing = page.locator("#bang-gia");
  await expect(pricing.locator(".starter-summary")).toContainText("Miễn phí");
  await expect(pricing.locator(".pricing-quotas li")).toHaveCount(8);
  await expect(pricing.locator(".starter-summary a")).toHaveCount(1);
  await expect(pricing.locator(".pricing-status")).toContainText("chưa phải cam kết");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
