import { expect, test } from "@playwright/test";
import { registerVerified } from "./auth-nav";
import { latestEmailText } from "./db";

test("quên mật khẩu → link trong mail → mật khẩu mới đăng nhập được", async ({ page }) => {
  const { email } = await registerVerified(page, "Reset Bot");
  await page.goto("/login");
  await page.getByRole("link", { name: "Quên mật khẩu?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Gửi link đặt lại" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Kiểm tra hộp thư");

  const text = await latestEmailText(email, "password_reset");
  const link = text.match(/https?:\/\/\S+\/reset-password\?token=[A-Za-z0-9]+/)?.[0];
  expect(link, "link đặt lại trong mail").toBeTruthy();
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await page.getByLabel("Mật khẩu mới").fill("newpassword1");
  await page.getByLabel("Nhập lại mật khẩu").fill("newpassword1");
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // Link dùng một lần: token đã dùng chỉ báo lỗi sau khi submit lại.
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await page.getByLabel("Mật khẩu mới").fill("newpassword1");
  await page.getByLabel("Nhập lại mật khẩu").fill("newpassword1");
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByText("Link đã hết hạn hoặc đã được dùng.")).toBeVisible();
});
