import { expect, type Page, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyEmail } from "./auth-nav";

/**
 * Task detail smoke after web cutover: suite detail, comment compose, and
 * attachment upload are always on (no parity flag harness).
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

async function createAndOpenTask(page: Page) {
  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  await page.getByRole("button", { name: "Tạo việc" }).click();
  await page.getByLabel("Tiêu đề").fill(taskTitle);
  await page.getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 15_000 });
  await page.getByText(taskTitle).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks/[0-9A-Z]+`), {
    timeout: 15_000,
  });
}

test("task detail: suite comment + attachment always on", async ({ page }) => {
  await onboardToTasks(page);
  await createAndOpenTask(page);

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
