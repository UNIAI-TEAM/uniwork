import { expect, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

// Meeting lifecycle without LiveKit: tạo → bắt đầu → panel tóm tắt AI hiện
// (kèm trạng thái AI tắt) → tải .ics → kết thúc → ENDED. Yêu cầu `make dev`.
const stamp = Date.now();
const email = `e2e-mtg-${stamp}@example.com`;

test("meeting: create → start → summary panel → ics → end", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("E2E Meet");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page).toHaveURL(/\/verify$/);
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
  await page.getByRole("button", { name: "Tạo cuộc họp" }).click();
  await page.getByLabel("Tiêu đề").fill("Họp AI e2e");
  await page.getByRole("button", { name: "Tạo", exact: true }).click();
  // Creating opens the detail page; on older builds the list stays — click through then.
  await expect(page.getByText("Họp AI e2e").first()).toBeVisible();
  if (!/\/meetings\/[0-9A-Z]+$/.test(page.url())) await page.getByText("Họp AI e2e").first().click();
  await expect(page).toHaveURL(/\/meetings\/[0-9A-Z]+$/);
  await expect(page.getByRole("heading", { name: "Họp AI e2e" })).toBeVisible();

  // Scheduled: no summary panel yet, calendar available.
  await expect(page.getByTestId("meeting-summary-panel")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Thêm vào lịch" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.ics$/);

  await page.getByRole("button", { name: "Bắt đầu" }).click();
  await expect(page.getByText("Đang diễn ra")).toBeVisible({ timeout: 10_000 });
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
