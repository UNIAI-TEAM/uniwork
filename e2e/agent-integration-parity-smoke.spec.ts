import { expect, type Page, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

/**
 * Post-cutover regression: user-facing agent chrome is gone. Suite task detail
 * loads without Squads/Runtimes nav or AgentRun/PR panels.
 *
 * GATE_LEVEL=fast skips E2E in `make check`; CI / `make check-full` still run this.
 */
const stamp = Date.now();
const orgSlug = `org-agent-${stamp}`;
const wsSlug = `doi-agent-${stamp}`;
const email = `agent-parity-${stamp}@example.com`;
const taskTitle = `Việc agent parity ${stamp}`;

async function onboardToTasks(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Agent Parity");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Org Agent ${stamp}`);
  await page.getByRole("button", { name: `Tạo Org Agent ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill(`Đội Agent ${stamp}`);
  await page.getByRole("button", { name: `Tạo Đội Agent ${stamp}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks`), { timeout: 15_000 });
  await page.getByRole("button", { name: "Đã hiểu" }).click({ timeout: 15_000 });
}

async function createAndOpenTask(page: Page) {
  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  await page.getByRole("button", { name: "Việc mới" }).click();
  await page.getByLabel("Tiêu đề").fill(taskTitle);
  await page.getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 15_000 });
  await page.getByText(taskTitle).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks/[0-9A-Z]+`), {
    timeout: 15_000,
  });
}

test("agent chrome hidden: no Squads/Runtimes nav or AgentRun panels", async ({ page }) => {
  await onboardToTasks(page);

  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  await expect(page.getByRole("link", { name: "Squad" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Runtime" })).toHaveCount(0);

  await createAndOpenTask(page);
  await expect(page.getByTestId("task-detail-suite")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("task-detail-agent-run-panel")).toHaveCount(0);
  await expect(page.getByTestId("task-detail-pull-requests")).toHaveCount(0);
});
