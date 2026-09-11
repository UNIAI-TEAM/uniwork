import { expect, type Page, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

/**
 * Collection surfaces smoke after web cutover: suite mode controls are always
 * on for /tasks and /my-tasks (no parity flag harness).
 *
 * GATE_LEVEL=fast skips E2E in `make check`; CI / `make check-full` still run this.
 */
const stamp = Date.now();
const orgSlug = `org-parity-${stamp}`;
const wsSlug = `doi-parity-${stamp}`;
const email = `parity-${stamp}@example.com`;

async function onboardToTasks(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Parity Smoke");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Org Parity ${stamp}`);
  await page.getByRole("button", { name: `Tạo Org Parity ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill(`Đội Parity ${stamp}`);
  await page.getByRole("button", { name: `Tạo Đội Parity ${stamp}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks`), { timeout: 15_000 });
  await page.getByRole("button", { name: "Đã hiểu" }).click({ timeout: 15_000 });
}

test("tasks collection: suite mode controls always on", async ({ page }) => {
  await onboardToTasks(page);

  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  await expect(page.getByTestId("task-mode-switcher")).toBeVisible({ timeout: 15_000 });

  await page.goto(`/${orgSlug}/${wsSlug}/my-tasks`);
  await expect(page.getByRole("heading", { name: "Việc của tôi" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("task-mode-switcher")).toBeVisible();

  // My-tasks must not expose workspace table mode (no relation filter on /tasks/table/*).
  await page.getByTestId("task-mode-switcher").click();
  await expect(page.getByTestId("task-mode-list")).toBeVisible();
  await expect(page.getByTestId("task-mode-board")).toBeVisible();
  await expect(page.getByTestId("task-mode-swimlane")).toBeVisible();
  await expect(page.getByTestId("task-mode-table")).toHaveCount(0);

  const filterAdd = page.getByTestId("task-filter-add");
  await expect(filterAdd).toBeVisible();
  await expect(filterAdd).toBeDisabled();
  await expect(filterAdd).toHaveAttribute("data-reason-code", "filters_not_wired");
});
