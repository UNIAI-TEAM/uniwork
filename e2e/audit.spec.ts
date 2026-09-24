import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { verifyEmail } from "./auth-nav";
import { backdateAuditExports } from "./db";

// The golden path for F-08: a change to a task appears in the organization's
// immutable log, with the field that moved. The whole point of the feature is
// that this is true without anyone remembering to log anything, so the test
// makes an ordinary edit and then goes looking for it.
//
// Requires `make dev`.
const stamp = Date.now();
const email = `audit-${stamp}@example.com`;
const orgSlug = `kiem-toan-${stamp}`;

test("a task edit shows up in the organization's audit log", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Audit Bot");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("radio", { name: "Quản lý" }).click();
  await page.getByRole("checkbox", { name: "Họp trực tuyến" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Kiểm toán ${stamp}`);
  await page.getByRole("button", { name: `Tạo Kiểm toán ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill("Đội Audit");
  await page.getByRole("button", { name: "Tạo Đội Audit" }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();

  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/doi-audit/tasks$`), { timeout: 15_000 });
  await Promise.all([
    page.waitForURL(/\/tasks\/[0-9A-Z]+$/, { timeout: 30_000 }),
    page.getByRole("button", { name: "Để sau" }).click(),
  ]);

  // An ordinary edit. Suite title is lazy: click to activate the TipTap textbox.
  await page.getByRole("button", { name: "Bắt đầu với UniWork" }).click();
  const title = page.getByRole("textbox", { name: "Tiêu đề công việc" });
  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.fill(`Việc đã đổi ${stamp}`);
  await title.blur();
  // Suite timeline is comments-only for now; the org audit log is the F-08 proof.
  await expect(page.getByRole("button", { name: `Việc đã đổi ${stamp}` })).toBeVisible({
    timeout: 15_000,
  });

  await page.goto(`/${orgSlug}/doi-audit/settings?tab=audit`);
  await expect(page.getByRole("heading", { name: "Nhật ký hoạt động" })).toBeVisible();

  // The founder is the organization owner, so the log is theirs to read, and
  // the entry names the field that moved rather than the whole row.
  await expect(page.getByRole("cell", { name: /Cập nhật việc/ }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("cell", { name: /Tiêu đề/ }).first()).toBeVisible();

  // Filtering to something nobody did leaves an honest empty state, not rows.
  // The filter applies as it is picked; there is no submit button.
  await page.getByLabel("Hành động").click();
  await page.getByRole("option", { name: "Thu hồi phiên" }).click();
  await expect(page.getByText("Chưa có bản ghi nào khớp")).toBeVisible({ timeout: 15_000 });

  // Clearing brings the entries back without another click.
  await page.getByRole("button", { name: "Xóa bộ lọc" }).first().click();
  await expect(page.getByRole("cell", { name: /Cập nhật việc/ }).first()).toBeVisible({ timeout: 15_000 });
});

/**
 * Signs up an owner with one organization and workspace and lands on the task
 * list. Export jobs live under organization settings, so every export case needs
 * exactly this much world and nothing more.
 */
async function onboardOwner(page: Page, tag: string) {
  const ownerStamp = Date.now();
  const ownerEmail = `${tag}-${ownerStamp}@example.com`;
  const slug = `kiem-toan-${ownerStamp}`;
  const orgName = `Kiểm toán ${ownerStamp}`;
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Audit Bot");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("radio", { name: "Quản lý" }).click();
  await page.getByRole("checkbox", { name: "Họp trực tuyến" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByLabel("Tên tổ chức").fill(orgName);
  await page.getByRole("button", { name: `Tạo ${orgName}` }).click();
  await page.getByLabel("Tên workspace").fill("Đội Audit");
  await page.getByRole("button", { name: "Tạo Đội Audit" }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/doi-audit/tasks$`), { timeout: 15_000 });
  return { stamp: ownerStamp, email: ownerEmail, slug };
}

/**
 * Picks a day in a DateField. The calendar renders every day as a button whose
 * `data-day` is that day formatted for the UI locale ("24/9/2026" in
 * Vietnamese), so the cell is matched on its three numbers rather than on the
 * visible text — the same day would otherwise collide with an outside day.
 */
async function pickDay(page: Page, fieldId: string, date: Date): Promise<void> {
  await page.locator(`#${fieldId}`).click();
  const days = page.locator("[data-day]");
  await expect(days.first()).toBeVisible({ timeout: 10_000 });
  const labels = await days.evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-day") ?? ""));
  const wanted = [date.getDate(), date.getMonth() + 1, date.getFullYear()].join("-");
  const index = labels.findIndex((label) => {
    const parts = label.match(/\d+/g)?.map(Number) ?? [];
    return parts.length === 3 && parts.join("-") === wanted;
  });
  if (index < 0) throw new Error(`no calendar cell for ${wanted}: ${labels.join(", ")}`);
  await days.nth(index).click();
}

/**
 * Queues an export over today and waits for the worker to finish it. The list
 * polls while a job is running, so the link appearing is the module's own
 * signal — there is no response to wait for.
 */
async function createTodaysExport(page: Page, format: "CSV" | "JSON Lines") {
  await page.getByLabel("Định dạng").click();
  await page.getByRole("option", { name: format }).click();
  await pickDay(page, "audit-export-from", new Date());
  await pickDay(page, "audit-export-to", new Date());
  await page.getByRole("button", { name: "Tạo bản xuất" }).click();
  const download = page.getByRole("link", { name: "Tải về" });
  await expect(download).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Xong").first()).toBeVisible();
  return download;
}

/** Reads the bytes a download produced. */
async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error("the download has no path");
  return readFile(path);
}

// Bước 0 smoke: the shortest path that proves the module still works on the
// legacy storage path — create an export, watch it finish, download the file,
// and check the bytes are the log's own.
test("@files-smoke audit export: an owner creates a CSV and downloads it", async ({ page }) => {
  test.setTimeout(120_000);
  const { slug } = await onboardOwner(page, "audit-export-smoke");
  await page.goto(`/${slug}/doi-audit/settings?tab=audit`);
  await expect(page.getByRole("heading", { name: "Nhật ký hoạt động" })).toBeVisible({ timeout: 15_000 });

  const link = await createTodaysExport(page, "CSV");
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const body = await downloadBytes(download);

  // Excel on a Vietnamese Windows reads a BOM-less UTF-8 file as the system
  // code page, which is the whole reason the exporter prefixes one.
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = body.toString("utf8");
  const [header, ...rows] = text.trim().split("\n");
  expect(header).toBe(
    "id,occurred_at,actor_kind,actor_id,action,resource_type,resource_id,workspace_id,changes,metadata,correlation_id",
  );
  expect(rows.length).toBeGreaterThan(0);
  // The organization the reader just created is the one the file describes.
  expect(text).toContain("organization.created");
  expect(text).toContain("workspace.created");
  // An export leaves the system entirely, so it never carries an address.
  expect(text).not.toContain("ip_address");
});

// The other leg of T10: JSON Lines fidelity, and the 24h window the migration
// has to keep. The clock is moved in the database rather than waited out; the
// app reads `completed_at`, so this is the state a day would produce.
test("audit export: JSON Lines mirrors the log, and a lapsed link is withdrawn", async ({ page }) => {
  test.setTimeout(120_000);
  const { slug } = await onboardOwner(page, "audit-export-json");
  await page.goto(`/${slug}/doi-audit/settings?tab=audit`);
  await expect(page.getByRole("heading", { name: "Nhật ký hoạt động" })).toBeVisible({ timeout: 15_000 });

  const link = await createTodaysExport(page, "JSON Lines");
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const lines = (await downloadBytes(download)).toString("utf8").trim().split("\n");
  expect(lines.length).toBeGreaterThan(0);
  // One object per line, not one array: a truncated file stays parseable up to
  // its last whole line.
  expect(lines[0]).toMatch(/^\{/);
  for (const line of lines) {
    const row = JSON.parse(line) as Record<string, unknown>;
    expect(row.organization_id).toBeTruthy();
    expect(row.action).toBeTruthy();
    expect(row.ip_address).toBeUndefined();
  }

  // A day later the job is still listed with its history; only the link is gone.
  const moved = await backdateAuditExports(slug, 25);
  expect(moved).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nhật ký hoạt động" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Tải về" })).toHaveCount(0);
  await expect(page.getByText("Xong").first()).toBeVisible();
});