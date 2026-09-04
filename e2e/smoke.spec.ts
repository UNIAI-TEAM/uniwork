import { expect, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

// Smoke: đăng ký → onboarding tối thiểu (tổ chức + workspace) → tạo task → mở detail → tạo meeting → mở phòng.
// Yêu cầu `make dev` đang chạy. Mỗi lần chạy dùng email mới để không đụng dữ liệu cũ.
const stamp = Date.now();
const email = `e2e-${stamp}@example.com`;

test("register → workspace → task → meeting", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("E2E Bot");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page).toHaveURL(/\/verify$/);
  await verifyEmail(page);

  // onboarding: welcome → bỏ qua "về bạn" → tổ chức → workspace → bỏ qua mời → 🎉
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Org E2E ${stamp}`);
  await page.getByRole("button", { name: `Tạo Org E2E ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill(`Đội E2E ${stamp}`);
  await expect(page.getByLabel("Đường dẫn")).toHaveValue(`doi-e2e-${stamp}`);
  await page.getByRole("button", { name: `Tạo Đội E2E ${stamp}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/org-e2e-${stamp}/doi-e2e-${stamp}/tasks`), { timeout: 15_000 });
  await page.getByRole("button", { name: "Đã hiểu" }).click({ timeout: 15_000 });
  await page.goto(`/org-e2e-${stamp}/doi-e2e-${stamp}/tasks`);

  // tạo task
  await page.getByRole("button", { name: "Việc mới" }).click();
  await page.getByLabel("Tiêu đề").fill("Task từ e2e");
  await page.getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(page.getByText("Task từ e2e")).toBeVisible();

  // mở detail
  await page.getByText("Task từ e2e").click();
  await expect(page).toHaveURL(/\/tasks\/[0-9A-Z]+/);

  // tạo meeting
  await page.goto(`/org-e2e-${stamp}/doi-e2e-${stamp}/meetings`);
  // Header action and the empty-state CTA share the label; either opens the dialog.
  await page.getByRole("button", { name: "Tạo cuộc họp" }).first().click();
  await page.getByLabel("Tiêu đề").fill("Họp e2e");
  // Schedule defaults (date + TimeInput segments) are prefilled; smoke only needs a title.
  await page.getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/org-e2e-${stamp}/doi-e2e-${stamp}/meetings/[0-9A-Z]+`), { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Họp e2e" })).toBeVisible();

  // mở phòng: chấp nhận 1 trong 2 trạng thái (LiveKit cấu hình hoặc chưa)
  await page.getByRole("button", { name: "Bắt đầu" }).click();
  // Detail → /room lands on the pre-join screen, whose join button carries
  // the same label; the second click is what asks the server for a token.
  await page.getByRole("button", { name: "Vào phòng họp" }).click();
  await expect(page.getByText("Sẵn sàng vào họp")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Vào phòng họp" }).click();
  await expect(
    page
      .getByText("LiveKit chưa được cấu hình trên server")
      .or(page.getByText("Đang chờ người chủ trì bắt đầu cuộc họp"))
      .or(page.locator("[data-lk-theme]")),
  ).toBeVisible({ timeout: 15_000 });
});
