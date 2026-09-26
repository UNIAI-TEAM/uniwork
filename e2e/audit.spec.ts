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
    // "Để sau" only dismisses the welcome dialog; this button opens the guide task.
    page.getByRole("button", { name: "Mở task hướng dẫn" }).click(),
  ]);

  // An ordinary edit. Suite title is lazy: click to activate the TipTap textbox.
  await page.getByRole("button", { name: "Bắt đầu với UniWork" }).click();
  const title = page.getByRole("textbox", { name: "Tiêu đề công việc" });
  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.fill(`Việc đã đổi ${stamp}`);
  // Once activated the title editor stays mounted, so wait for the save itself.
  const saved = page.waitForResponse(
    (res) => res.request().method() === "PUT" && /\/api\/v1\/tasks\/[0-9A-Z]+$/.test(res.url()) && res.ok(),
    { timeout: 15_000 },
  );
  await title.blur();
  await saved;
  // Suite timeline is comments-only for now; the org audit log is the F-08 proof.

  await page.goto(`/${orgSlug}/doi-audit/settings?tab=audit`);
  await expect(page.getByRole("heading", { name: "Nhật ký hoạt động" })).toBeVisible();

  // The founder is the organization owner, so the log is theirs to read, and
  // the entry names the field that moved rather than the whole row.
  await expect(page.getByRole("cell", { name: /Cập nhật việc/ }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("cell", { name: /Tiêu đề/ }).first()).toBeVisible();

  // Filtering to something nobody did leaves an honest empty state, not rows.
  // The filter applies as it is picked; there is no submit button.
  await page.getByLabel("Hành động").click();
  await page.getByRole("option", { name: "Thu hồi phiên" }).click();
  await expect(page.getByText("Chưa có bản ghi nào khớp")).toBeVisible({ timeout: 15_000 });

  // Clearing brings the entries back without another click.
  await page.getByRole("button", { name: "Xóa bộ lọc" }).first().click();
  await expect(page.getByRole("cell", { name: /Cập nhật việc/ }).first()).toBeVisible({ timeout: 15_000 });
});
