import { expect, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

// Smoke onboarding: đăng ký → welcome → về bạn → tổ chức → workspace → bỏ qua mời
// → landing 🎉 → task hướng dẫn. Yêu cầu `make dev` đang chạy.
const stamp = Date.now();
const email = `onb-${stamp}@example.com`;

test("register → onboarding 4 bước → 🎉 → task hướng dẫn", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Onboard Bot");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page).toHaveURL(/\/verify$/);
  await verifyEmail(page);

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("một không gian.");
  await expect(page.getByRole("button", { name: "Tôi đã dùng rồi" })).toHaveCount(0);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();

  // Về bạn
  await page.getByText("Cho chúng tôi biết đôi chút về bạn.").waitFor();
  await page.getByRole("radio", { name: "Quản lý" }).click();
  await page.getByRole("checkbox", { name: "Họp trực tuyến" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  // Tổ chức
  await page.getByRole("heading", { name: "Đặt tên tổ chức của bạn." }).waitFor();
  await page.getByLabel("Tên tổ chức").fill(`Tổ chức ${stamp}`);
  await expect(page.getByLabel("Đường dẫn")).toHaveValue(`to-chuc-${stamp}`);
  await page.getByRole("button", { name: `Tạo Tổ chức ${stamp}` }).click();

  // Workspace
  await page.getByRole("heading", { name: "Đặt tên workspace." }).waitFor();
  await page.getByLabel("Tên workspace").fill("Đội Alpha");
  await expect(page.getByText(`localhost:3000/to-chuc-${stamp}/`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tạo Đội Alpha" }).click();

  // Mời — bỏ qua
  await page.getByRole("heading", { name: /Mời đồng nghiệp vào Đội Alpha/ }).waitFor();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();

  await expect(page).toHaveURL(new RegExp(`/to-chuc-${stamp}/doi-alpha/tasks$`));
  await expect(page.getByRole("button", { name: "Đã hiểu" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Đã hiểu" }).click();
  // First client-side visit to the task detail route: under `make check` the
  // dev server compiles it while Go's -race suite is hammering the machine,
  // and that alone has exceeded the default 5s. Timing, not behaviour.
  await expect(page).toHaveURL(/\/tasks\/[0-9A-Z]+$/, { timeout: 15_000 });
  await expect(page.getByRole("textbox").first()).toHaveValue("Bắt đầu với UniWork");

  // Vào lại /onboarding khi đã onboard → bị đẩy về workspace
  await page.goto("/onboarding");
  await expect(page).toHaveURL(new RegExp(`/to-chuc-${stamp}/doi-alpha/tasks$`));
});
