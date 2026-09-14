import { expect, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";
import { assignWorkspaceTasksDueToday, clearE2EFlagOverride, setE2EFlagOverride } from "./db";

// Golden path for the home screen (spec 2026-09-14-home-trang-chu §7): with
// home_page on, the workspace root is Home and the sidebar leads with it; work
// assigned to me and due today is listed, and completing it from Home empties
// the list. Requires `make dev`.
const stamp = Date.now();
const email = `home-${stamp}@example.com`;
const orgSlug = `trang-chu-${stamp}`;
const wsSlug = "doi-home";

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  await setE2EFlagOverride("home_page", true);
});

test.afterAll(async () => {
  await clearE2EFlagOverride("home_page");
});

test("home lists my work due today and completes it", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Người Home");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Trang chủ ${stamp}`);
  await page.getByRole("button", { name: `Tạo Trang chủ ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill("Đội Home");
  await page.getByRole("button", { name: "Tạo Đội Home" }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks$`), { timeout: 15_000 });
  await page.getByRole("button", { name: "Để sau" }).click({ timeout: 15_000 });

  // The guide task is seeded behind the welcome dialog; make it mine, due today.
  let titles: string[] = [];
  await expect
    .poll(async () => (titles = await assignWorkspaceTasksDueToday(email, orgSlug, wsSlug)).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  const title = titles[0]!;

  // Flag overrides reach the server within its 30 s cache.
  await expect(async () => {
    await page.goto(`/${orgSlug}/${wsSlug}`);
    await expect(page.getByRole("heading", { name: "Trang chủ", level: 1 })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000, intervals: [3_000] });

  await expect(page.getByRole("link", { name: "Trang chủ", exact: true })).toHaveAttribute("aria-current", "page");
  const list = page.getByRole("listbox", { name: "Công việc của tôi" });
  await expect(list.getByText(title)).toBeVisible();
  await expect(list.getByText("Hạn hôm nay")).toBeVisible();

  await page.getByRole("button", { name: `Hoàn thành: ${title}` }).click();
  await expect(page.getByText("Không có việc cần xử lý")).toBeVisible({ timeout: 15_000 });
});
