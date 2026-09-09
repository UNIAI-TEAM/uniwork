import { expect, type Page, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyEmail } from "./auth-nav";

/**
 * Slice-5 task detail smoke: flag off keeps MVP detail; flag on (client
 * config harness) shows suite chrome, comment compose, and attachment upload
 * when `tasks.attachments` is available.
 *
 * GATE_LEVEL=fast skips E2E in `make check`; CI / `make check-full` still run this.
 */
const stamp = Date.now();
const orgSlug = `org-detail-${stamp}`;
const wsSlug = `doi-detail-${stamp}`;
const email = `detail-parity-${stamp}@example.com`;
const taskTitle = `Việc detail parity ${stamp}`;
const commentBody = `Comment parity ${stamp}`;
const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "parity-upload.txt",
);

async function onboardToTasks(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Detail Parity");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Org Detail ${stamp}`);
  await page.getByRole("button", { name: `Tạo Org Detail ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill(`Đội Detail ${stamp}`);
  await page.getByRole("button", { name: `Tạo Đội Detail ${stamp}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks`), { timeout: 15_000 });
  await page.getByRole("button", { name: "Đã hiểu" }).click({ timeout: 15_000 });
}

function installParityHarness(page: Page, state: { enabled: boolean }) {
  return page.route("**/api/v1/config**", async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as {
      flags?: Record<string, boolean>;
      work_management_capabilities?: Record<string, { status?: string }>;
    };
    json.flags = { ...(json.flags ?? {}), tasks_work_management_parity: state.enabled };
    json.work_management_capabilities = {
      ...(json.work_management_capabilities ?? {}),
      "tasks.attachments": { status: "available" },
    };
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

test("task detail: flag off MVP; flag on suite comment + attachment", async ({ page }) => {
  await onboardToTasks(page);

  const parity = { enabled: false };
  await installParityHarness(page, parity);
  await createAndOpenTask(page);

  await expect(page.getByTestId("task-detail-mvp")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("task-detail-suite")).toHaveCount(0);
  await expect(page.getByTestId("task-detail-timeline")).toHaveCount(0);
  await expect(page.getByTestId("task-comment-composer")).toHaveCount(0);

  parity.enabled = true;
  await page.reload();
  await expect(page.getByTestId("task-detail-suite")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("task-detail-mvp")).toHaveCount(0);
  await expect(page.getByTestId("task-detail-timeline")).toBeVisible();
  await expect(page.getByTestId("task-comment-composer")).toBeVisible();

  // Comment happy path: activate shell → type in TipTap → send.
  await page.getByTestId("task-comment-composer-shell").click();
  const editor = page.locator('[data-testid="task-comment-composer"] .ProseMirror');
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.type(commentBody);
  await page.getByRole("button", { name: "Gửi" }).click();
  await expect(page.getByText(commentBody)).toBeVisible({ timeout: 15_000 });

  // Attachment upload when capability is available.
  const uploadInput = page.locator('input[type="file"][aria-label="Thêm tệp"]');
  await expect(uploadInput).toBeAttached({ timeout: 15_000 });
  await uploadInput.setInputFiles(fixturePath);
  await expect(page.getByText("parity-upload.txt")).toBeVisible({ timeout: 20_000 });
});
