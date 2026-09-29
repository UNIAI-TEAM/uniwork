import { expect, test, type Page } from "@playwright/test";
import { auditText } from "./contrast";
import { createInstantMeeting, createRecordingAccount, loginViaUi } from "./meeting-recording-fixture";

/**
 * Tương phản chữ trong khung camera của màn chuẩn bị vào họp, ở cả hai chế độ.
 *
 * Khung là một vùng `dark` giữa trang sáng. `color` được tính tại nơi khai báo
 * rồi mới thừa kế, nên thứ gì không tự đặt màu chữ (nhãn nút outline "Bật camera
 * để xem trước") mang mực tối của trang sáng xuống nền tối — UNI-863. Đọc token
 * không thấy lỗi này, chỉ phép đo trên trang đã render mới thấy.
 */
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

async function setMode(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
}

for (const mode of ["light", "dark"] as const) {
  test(`chữ trong khung camera tắt ở màn chuẩn bị vào họp đạt WCAG AA — ${mode}`, async ({ page }) => {
    test.slow();
    const seed = await createRecordingAccount(page, api, `prejoin-${mode}`);
    const meeting = await createInstantMeeting(page, api, seed.token, seed.wsId, "Tương phản prejoin");
    await loginViaUi(page, seed.email);
    await page.goto(`/${seed.orgSlug}/${seed.wsSlug}/meetings/${meeting.id}/room`);
    await expect(page.getByTestId("meeting-prejoin")).toBeVisible({ timeout: 30_000 });

    const camera = page.getByRole("button", { name: "Camera", exact: true });
    if ((await camera.getAttribute("aria-pressed")) === "true") await camera.click();
    const turnOn = page.getByRole("button", { name: "Bật camera để xem trước" });
    await expect(turnOn).toBeVisible();

    await setMode(page, mode);
    const frame = await auditText(page, "[data-testid='meeting-prejoin'] .dark");
    expect(frame.colorLevel4, "trình duyệt không nhận CSS Color 4 trong canvas — phép đo sẽ sai âm thầm").toBe(true);
    expect(frame.checked, "không đo được node chữ nào — selector đã trượt").toBeGreaterThan(1);
    expect(frame.fails, `Khung camera (${mode}): ${frame.fails.join(" | ")}`).toEqual([]);
  });
}
