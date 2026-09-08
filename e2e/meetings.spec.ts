import { expect, test } from "@playwright/test";
import { register, verifyEmail } from "./auth-nav";

// Meeting lifecycle without LiveKit: tạo → bắt đầu → panel tóm tắt AI hiện
// (kèm trạng thái AI tắt) → tải .ics → kết thúc → ENDED. Yêu cầu `make dev`.
const stamp = Date.now();

test("meeting: create → start → summary panel → ics → end", async ({ page }) => {
  await register(page, "E2E Meet", stamp);
  await verifyEmail(page);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Org M ${stamp}`);
  await page.getByRole("button", { name: `Tạo Org M ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill(`Đội M ${stamp}`);
  await page.getByRole("button", { name: `Tạo Đội M ${stamp}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/org-m-${stamp}/doi-m-${stamp}/tasks`), { timeout: 15_000 });
  await page.getByRole("button", { name: "Đã hiểu" }).click({ timeout: 15_000 });

  await page.goto(`/org-m-${stamp}/doi-m-${stamp}/meetings`);
  // Header action and the empty-state CTA share the label; either opens the dialog.
  await page.getByRole("button", { name: "Tạo cuộc họp" }).first().click();
  await page.getByLabel("Tiêu đề").fill("Họp AI e2e");
  await page.getByRole("button", { name: "Tạo", exact: true }).click();
  // Creating navigates to the detail page. 15s: under `next dev` the first
  // visit compiles /meetings/[meetingId], which alone can take longer than
  // the 5s default.
  await expect(page).toHaveURL(/\/meetings\/[0-9A-Z]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Họp AI e2e" })).toBeVisible();

  // Scheduled: no summary panel yet, calendar available.
  await expect(page.getByTestId("meeting-summary-panel")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Thêm vào lịch" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.ics$/);

  await page.getByRole("button", { name: "Bắt đầu" }).click();
  // exact: the activity timeline also renders "Đã lên lịch → Đang diễn ra".
  await expect(page.getByText("Đang diễn ra", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("meeting-summary-panel")).toBeVisible();
  // Without ANTHROPIC_API_KEY the panel explains that AI is off (or shows the
  // empty transcript hint when the key is set): either is a valid server state.
  await expect(
    page.getByText("Tóm tắt AI chưa được bật trên máy chủ này.").or(page.getByText(/Chưa có transcript/)).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Kết thúc" }).click();
  await page.getByRole("button", { name: /Kết thúc/ }).last().click();
  await expect(page.getByText("Đã kết thúc").first()).toBeVisible({ timeout: 10_000 });
});
