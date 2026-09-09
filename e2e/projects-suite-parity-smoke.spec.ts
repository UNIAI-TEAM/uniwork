import { expect, type Page, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

/**
 * Slice-4 projects suite smoke: flag off hides Projects nav and shows
 * unavailable on /projects; flag on (client config harness) lists projects,
 * creates one, and opens detail with TaskSurface chrome.
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

/**
 * Force public config so suite entry UI can load without a platform-admin MFA
 * path. Mutable so the same harness covers flag-off then flag-on (local
 * FF env / overrides may already enable parity).
 */
function installParityHarness(page: Page, state: { enabled: boolean }) {
  return page.route("**/api/v1/config**", async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as { flags?: Record<string, boolean> };
    json.flags = { ...(json.flags ?? {}), tasks_work_management_parity: state.enabled };
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      contentType: "application/json",
      body: JSON.stringify(json),
    });
  });
}

test("projects suite: flag off unavailable; flag on list + detail TaskSurface", async ({ page }) => {
  await onboardToTasks(page);

  const parity = { enabled: false };
  await installParityHarness(page, parity);
  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  await expect(page.getByRole("link", { name: "Dự án" })).toHaveCount(0);

  await page.goto(`/${orgSlug}/${wsSlug}/projects`);
  await expect(page.getByText("Chưa khả dụng")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Dự án" })).toHaveCount(0);

  parity.enabled = true;
  await page.goto(`/${orgSlug}/${wsSlug}/projects`);
  await expect(page.getByRole("heading", { name: "Dự án" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Dự án" })).toBeVisible();

  await page.getByRole("button", { name: "Dự án mới" }).click();
  await page.getByLabel("Tiêu đề dự án").fill(projectTitle);
  await page.getByRole("button", { name: "Tạo", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/projects/[^/]+`), {
    timeout: 15_000,
  });
  await expect(page.getByTestId("task-mode-switcher")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Tài nguyên" })).toBeVisible();
});
