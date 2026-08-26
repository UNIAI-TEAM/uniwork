import { expect, test, type Page } from "@playwright/test";
import { auditText } from "./contrast";

/**
 * Tương phản chữ của hai màn tín thư (đăng nhập / đăng ký).
 *
 * Chúng là hai màn duy nhất người CHƯA đăng nhập nhìn thấy, và là màn duy nhất
 * đặt chữ lên panel rail tối — nơi token màu chạy trong subtree `.dark` kể cả
 * khi cả app đang sáng. Chỉ phép đo trên trang đã render mới bắt được chỗ đó.
 */
async function setMode(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
}

for (const mode of ["light", "dark"] as const) {
  test(`tương phản chữ đạt WCAG AA — /login ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByLabel("Mật khẩu", { exact: true }).waitFor();
    await setMode(page, mode);

    const clean = await auditText(page);
    expect(clean.colorLevel4, "trình duyệt không nhận CSS Color 4 trong canvas — phép đo sẽ sai âm thầm").toBe(true);
    expect(clean.checked, "không đo được node chữ nào — selector đã trượt").toBeGreaterThan(5);
    expect(clean.fails, `/login (${mode}): ${clean.fails.join(" | ")}`).toEqual([]);

    // Trạng thái lỗi vẽ chữ destructive lên nền trang. Nó chỉ tồn tại sau một
    // lần gửi hỏng, nên không đo ở đây thì không bao giờ được đo.
    await page.getByLabel("Email").fill(`khong-ton-tai-${Date.now()}@example.com`);
    await page.getByLabel("Mật khẩu", { exact: true }).fill("saibetnhe123");
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await page.getByText("Email hoặc mật khẩu không đúng").waitFor();
    await setMode(page, mode);

    const failed = await auditText(page);
    expect(failed.fails, `/login lỗi (${mode}): ${failed.fails.join(" | ")}`).toEqual([]);
  });

  test(`tương phản chữ đạt WCAG AA — /register ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const email = `contrast-reg-${mode}-${Date.now()}@example.com`;
    await page.goto("/register");
    await page.getByLabel("Mật khẩu", { exact: true }).waitFor();
    await setMode(page, mode);

    const clean = await auditText(page);
    expect(clean.checked, "không đo được node chữ nào — selector đã trượt").toBeGreaterThan(5);
    expect(clean.fails, `/register (${mode}): ${clean.fails.join(" | ")}`).toEqual([]);

    // Đăng ký thật một lần, rồi quay lại đăng ký đúng email đó: "email đã được
    // đăng ký" là lỗi gắn vào MỘT trường, và là trạng thái lỗi duy nhất màn này
    // vẽ ra được.
    await page.getByLabel("Tên hiển thị").fill("Contrast");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
    await page.getByRole("button", { name: "Đăng ký" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);

    await page.goto("/register");
    await page.getByLabel("Tên hiển thị").fill("Contrast");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
    await page.getByRole("button", { name: "Đăng ký" }).click();
    await page.getByText("Email đã được đăng ký").waitFor();
    await setMode(page, mode);

    const failed = await auditText(page);
    expect(failed.fails, `/register lỗi (${mode}): ${failed.fails.join(" | ")}`).toEqual([]);
  });
}
