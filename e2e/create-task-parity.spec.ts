import { expect, type Page, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyEmail } from "./auth-nav";

/**
 * End-to-end contract for the create-task dialog after Multica parity slices
 * (UNI-645…UNI-648): fields, create-another, draft recovery, duplicate toast,
 * View-task navigation, and staged attachment bind.
 *
 * GATE_LEVEL=fast skips E2E in `make check`; CI / `make check-full` still run this.
 */
const stamp = Date.now();
const orgSlug = `org-create-${stamp}`;
const wsSlug = `doi-create-${stamp}`;
const email = `create-parity-${stamp}@example.com`;
const titleA = `Tạo việc parity ${stamp}`;
const titleB = `Tạo việc khác ${stamp}`;
const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "parity-upload.txt",
);

/** POST create only — not table/rows, query, or batch. */
function isCreateTaskPost(url: string, method: string): boolean {
  if (method !== "POST") return false;
  try {
    const { pathname } = new URL(url);
    return /\/api\/v1\/workspaces\/[^/]+\/tasks$/.test(pathname);
  } catch {
    return false;
  }
}

async function onboardToTasks(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Create Parity");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Org Create ${stamp}`);
  await page.getByRole("button", { name: `Tạo Org Create ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill(`Đội Create ${stamp}`);
  await page.getByRole("button", { name: `Tạo Đội Create ${stamp}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks`), { timeout: 15_000 });
  await page.getByRole("button", { name: "Để sau" }).click({ timeout: 15_000 });
}

async function openCreateDialog(page: Page) {
  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  // exact: board cards whose title starts with "Tạo việc …" also match the role name.
  await page.getByRole("button", { name: "Tạo việc", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
}

test("create task: fields, draft recovery, duplicate, view action, attachment", async ({ page }) => {
  await onboardToTasks(page);
  await openCreateDialog(page);

  const dialog = page.getByRole("dialog");
  const title = dialog.getByPlaceholder("Tiêu đề issue");
  await title.fill("Bản nháp tạm");
  const description = dialog.getByRole("textbox", { name: "Mô tả" });
  await description.click();
  await page.keyboard.type(`Mô tả parity ${stamp}`);

  // Closing without create must keep the draft for the next open.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await page.getByRole("button", { name: "Tạo việc", exact: true }).click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(title).toHaveValue("Bản nháp tạm");

  await title.fill(titleA);
  const createAnother = dialog.getByRole("switch", { name: "Tạo tiếp" });
  await createAnother.click();
  const createAnotherRes = page.waitForResponse(
    (r) => isCreateTaskPost(r.url(), r.request().method()),
    { timeout: 15_000 },
  );
  await dialog.getByRole("button", { name: "Tạo", exact: true }).click();
  const firstRes = await createAnotherRes;
  expect(firstRes.ok(), await firstRes.text()).toBeTruthy();
  // create-another keeps the dialog open with a fresh title.
  await expect(dialog).toBeVisible();
  await expect(title).toHaveValue("", { timeout: 10_000 });

  await title.fill(titleB);
  const upload = dialog.locator('input[type="file"]');
  await upload.setInputFiles(fixturePath);
  await expect(dialog.getByText("parity-upload.txt")).toBeVisible({ timeout: 20_000 });
  await createAnother.click();
  const createAndClose = page.waitForResponse(
    (r) => isCreateTaskPost(r.url(), r.request().method()),
    { timeout: 15_000 },
  );
  await dialog.getByRole("button", { name: "Tạo", exact: true }).click();
  const secondRes = await createAndClose;
  expect(secondRes.ok(), await secondRes.text()).toBeTruthy();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  // Duplicate guard: same title while the first task is still open.
  await page.getByRole("button", { name: "Tạo việc", exact: true }).click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await title.fill(titleA);
  const duplicatePost = page.waitForResponse(
    (r) => isCreateTaskPost(r.url(), r.request().method()),
    { timeout: 15_000 },
  );
  await dialog.getByRole("button", { name: "Tạo", exact: true }).click();
  const dupRes = await duplicatePost;
  expect(dupRes.status()).toBe(409);
  await expect(page.getByText("Đã có task đang mở với tiêu đề này")).toBeVisible({
    timeout: 15_000,
  });
  await expect(title).toHaveValue(titleA);

  // View existing from the duplicate toast (not the success "Đã tạo" toasts).
  await page
    .getByRole("listitem")
    .filter({ hasText: "Đã có task đang mở với tiêu đề này" })
    .getByRole("button", { name: "Xem task" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks/[0-9A-Z]+`), {
    timeout: 15_000,
  });
  await expect(page.getByText(titleA).first()).toBeVisible({ timeout: 15_000 });
});
