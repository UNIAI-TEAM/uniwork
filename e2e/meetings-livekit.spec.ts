import { expect, test } from "@playwright/test";
import { register, verifyEmail } from "./auth-nav";

// LiveKit media smoke: requires LiveKit + E2E_LIVEKIT=1. Skipped in default CI
// (meetings.spec.ts covers lifecycle without LiveKit).
const livekitEnabled = process.env.E2E_LIVEKIT === "1";

test.describe("meeting livekit smoke", () => {
  test.skip(!livekitEnabled, "set E2E_LIVEKIT=1 with LiveKit running");

  test("instant meeting → prejoin → stage shell", async ({ page }) => {
    const stamp = Date.now();
    await register(page, "E2E LK", stamp);
    await verifyEmail(page);
    await page.getByRole("button", { name: /Bắt đầu/ }).click();
    await page.getByRole("button", { name: "Bỏ qua" }).click();
    await page.getByLabel("Tên tổ chức").fill(`Org LK ${stamp}`);
    await page.getByRole("button", { name: `Tạo Org LK ${stamp}` }).click();
    await page.getByLabel("Tên workspace").fill(`Đội LK ${stamp}`);
    await page.getByRole("button", { name: `Tạo Đội LK ${stamp}` }).click();
    await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
    await expect(page).toHaveURL(new RegExp(`/org-lk-${stamp}/doi-lk-${stamp}/tasks`), { timeout: 15_000 });
    await page.getByRole("button", { name: "Đã hiểu" }).click({ timeout: 15_000 });

    await page.goto(`/org-lk-${stamp}/doi-lk-${stamp}/meetings`);
    await page.getByRole("button", { name: "Tạo cuộc họp" }).first().click();
    await page.getByLabel("Tiêu đề").fill("LiveKit smoke");
    await page.getByRole("button", { name: "Tạo", exact: true }).click();
    await expect(page).toHaveURL(/\/meetings\/[0-9A-Z]+$/, { timeout: 15_000 });

    await page.getByRole("button", { name: "Bắt đầu" }).click();
    await expect(page.getByText("Đang diễn ra", { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Vào phòng họp" }).click();
    await expect(page.getByTestId("meeting-prejoin")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Vào phòng|Tham gia/i }).last().click();
    await expect(page.getByTestId("meeting-stage")).toBeVisible({ timeout: 30_000 });
  });
});
