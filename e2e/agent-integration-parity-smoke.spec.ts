import { expect, type Page, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

/**
 * Slice-6 agent/integration smoke: flag off hides Squads/Runtimes nav and
 * keeps MVP task detail without suite AgentRun/PR stubs; flag on (client
 * config harness) loads /squads + /runtimes shells and shows disabled
 * AgentRun/PR chrome on suite task detail.
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

test("agent integration: flag off nav/MVP; flag on shells + disabled stubs", async ({ page }) => {
  await onboardToTasks(page);

  const parity = { enabled: false };
  await installParityHarness(page, parity);
  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  await expect(page.getByRole("link", { name: "Squad" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Runtime" })).toHaveCount(0);

  await createAndOpenTask(page);
  await expect(page.getByTestId("task-detail-mvp")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("task-detail-suite")).toHaveCount(0);
  await expect(page.getByTestId("task-detail-agent-run-panel")).toHaveCount(0);
  await expect(page.getByTestId("task-detail-pull-requests")).toHaveCount(0);

  parity.enabled = true;
  await page.goto(`/${orgSlug}/${wsSlug}/squads`);
  await expect(page.getByRole("heading", { name: "Squad" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("squads-create-stub")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("link", { name: "Squad" })).toBeVisible();

  await page.goto(`/${orgSlug}/${wsSlug}/runtimes`);
  await expect(page.getByRole("heading", { name: "Runtime" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("runtimes-create-stub")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("link", { name: "Runtime" })).toBeVisible();

  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  await page.getByText(taskTitle).click();
  await expect(page.getByTestId("task-detail-suite")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("task-detail-agent-run-panel")).toBeVisible();
  await expect(page.getByTestId("task-detail-pull-requests")).toBeVisible();
  await expect(page.getByTestId("task-detail-agent-run-stub")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("task-detail-pr-stub")).toHaveAttribute("aria-disabled", "true");
});
