import { expect, test, type Page } from "@playwright/test";
import { auditText } from "./contrast";

/** Tương phản chữ của luồng onboarding. Phép đo ở `./contrast`. */
async function reach(page: Page, tag: string) {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(tag);
  await page.getByLabel("Email").fill(`${tag.toLowerCase()}-${stamp}@example.com`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByText("Cho chúng tôi biết đôi chút về bạn.").waitFor();
}

for (const mode of ["light", "dark"] as const) {
  test(`tương phản chữ đạt WCAG AA — ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await reach(page, `Contrast${mode}`);
    await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);

    const step1 = await auditText(page);
    expect(step1.colorLevel4, "trình duyệt không nhận CSS Color 4 trong canvas — phép đo sẽ sai âm thầm").toBe(true);
    expect(step1.checked, "không đo được node chữ nào — selector đã trượt").toBeGreaterThan(15);
    expect(step1.fails, `bước "Về bạn" (${mode}): ${step1.fails.join(" | ")}`).toEqual([]);

    // Bật CTA lên để đo nút primary ở trạng thái HOẠT ĐỘNG (lúc bị vô hiệu hoá
    // nó được miễn trừ, nên chỉ đo lúc này mới thấy màu chữ thật).
    await page.getByRole("radio", { name: "Quản lý" }).click();
    const enabled = await auditText(page);
    expect(enabled.fails, `CTA hoạt động (${mode}): ${enabled.fails.join(" | ")}`).toEqual([]);

    await page.getByRole("button", { name: "Tiếp tục" }).click();
    await page.getByRole("heading", { name: "Đặt tên tổ chức của bạn." }).waitFor();
    await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
    const step2 = await auditText(page);
    expect(step2.fails, `bước "Tổ chức" (${mode}): ${step2.fails.join(" | ")}`).toEqual([]);
  });
}
