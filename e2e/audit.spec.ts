import { expect, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

// The golden path for F-08: a change to a task appears in the organization's
// immutable log, with the field that moved. The whole point of the feature is
// that this is true without anyone remembering to log anything, so the test
// makes an ordinary edit and then goes looking for it.
//
// Requires `make dev`.
const stamp = Date.now();
const email = `audit-${stamp}@example.com`;
const orgSlug = `kiem-toan-${stamp}`;

test("a task edit shows up in the organization's audit log", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Audit Bot");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("radio", { name: "Quản lý" }).click();
  await page.getByRole("checkbox", { name: "Họp trực tuyến" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Kiểm toán ${stamp}`);
  await page.getByRole("button", { name: `Tạo Kiểm toán ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill("Đội Audit");
  await page.getByRole("button", { name: "Tạo Đội Audit" }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();

  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/doi-audit/tasks$`), { timeout: 15_000 });
  await Promise.all([
    page.waitForURL(/\/tasks\/[0-9A-Z]+$/, { timeout: 30_000 }),
    page.getByRole("button", { name: "Đã hiểu" }).click(),
  ]);

  // An ordinary edit. Nothing about it mentions auditing.
  const title = page.getByRole("textbox").first();
  await title.fill(`Việc đã đổi ${stamp}`);
  await title.blur();

  // The task's own activity list is the same rows, through the workspace gate.
  await expect(page.getByText("Cập nhật task").first()).toBeVisible({ timeout: 15_000 });

  await page.goto(`/${orgSlug}/doi-audit/settings?tab=audit`);
  await expect(page.getByRole("heading", { name: "Bảo mật & Nhật ký" })).toBeVisible();

  // The founder is the organization owner, so the log is theirs to read, and
  // the entry names the field that moved rather than the whole row.
  await expect(page.getByRole("cell", { name: /Cập nhật task/ }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("cell", { name: /title/ }).first()).toBeVisible();

  // Filtering to something nobody did leaves an honest empty state, not rows.
  await page.getByLabel("Hành động").selectOption("auth.session_revoked");
  await page.getByRole("button", { name: "Áp dụng" }).click();
  await expect(page.getByText("Chưa có bản ghi nào khớp")).toBeVisible({ timeout: 15_000 });
});
