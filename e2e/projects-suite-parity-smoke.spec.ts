import { expect, type Page, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

/**
 * Projects suite smoke after web cutover: Projects nav + list/detail are
 * always on (no parity flag harness).
 *
 * GATE_LEVEL=fast skips E2E in `make check`; CI / `make check-full` still run this.
 */
const stamp = Date.now();
const orgSlug = `org-proj-${stamp}`;
const wsSlug = `doi-proj-${stamp}`;
const email = `proj-parity-${stamp}@example.com`;
const projectTitle = `Dự án parity ${stamp}`;

async function onboardToTasks(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Projects Parity");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Org Proj ${stamp}`);
  await page.getByRole("button", { name: `Tạo Org Proj ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill(`Đội Proj ${stamp}`);
  await page.getByRole("button", { name: `Tạo Đội Proj ${stamp}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks`), { timeout: 15_000 });
  await page.getByRole("button", { name: "Đã hiểu" }).click({ timeout: 15_000 });
}

test("projects suite: list + detail TaskSurface always on", async ({ page }) => {
  await onboardToTasks(page);

  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  await expect(page.getByRole("link", { name: "Dự án" })).toBeVisible({ timeout: 15_000 });

  await page.goto(`/${orgSlug}/${wsSlug}/projects`);
  // Empty-state h2 "Chưa có dự án" substring-matches "Dự án"; pin the page h1.
  await expect(page.getByRole("heading", { name: "Dự án", exact: true, level: 1 })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Dự án mới" }).click();
  await page.getByLabel("Tiêu đề dự án").fill(projectTitle);
  await page.getByRole("button", { name: "Tạo", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/projects/[^/]+`), {
    timeout: 15_000,
  });
  await expect(page.getByTestId("task-mode-switcher")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Tài nguyên" })).toBeVisible();
});
