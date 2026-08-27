import { expect, test } from "@playwright/test";
import { register, VERIFICATION_CODE } from "./auth-nav";
import { auditText } from "./contrast";

/**
 * Màn xác thực email: cổng đầu tiên sau đăng ký. Mã sai hiện lỗi và xoá ô nhập,
 * nút gửi lại bị khoá 60s ngay khi vào (đăng ký vừa gửi một mã), mã đúng đưa
 * tới onboarding, và các trang sau cổng đẩy ngược về /verify khi chưa xác thực.
 */
test("mã sai → lỗi; gửi lại đang khoá; mã đúng → onboarding; cổng chặn khi chưa xác thực", async ({ page }) => {
  await register(page, "Verify Bot");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Xác thực email");

  // Chưa xác thực thì không vào được onboarding hay workspace.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/verify$/);
  await page.goto("/workspaces");
  await expect(page).toHaveURL(/\/verify$/);

  const resend = page.getByRole("button", { name: /Gửi lại sau \d+s/ });
  await expect(resend).toHaveAttribute("aria-disabled", "true");

  const code = page.getByLabel("Mã xác thực");
  await expect(code).toBeFocused();
  const wrong = VERIFICATION_CODE === "000000" ? "111111" : "000000";
  await code.fill(wrong);
  // getByRole("alert") cũng khớp route announcer của Next, nên tìm theo chữ.
  await expect(page.getByText("Mã không đúng hoặc đã hết hạn")).toBeVisible();
  await expect(code).toHaveValue("");

  await code.fill(VERIFICATION_CODE);
  await expect(page).toHaveURL(/\/onboarding$/);

  // Đã xác thực thì /verify không còn gì để làm.
  await page.goto("/verify");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("nút Google chỉ hiện khi server báo có Google", async ({ page }) => {
  // Đọc cờ từ chính request mà trang gửi, nên không cần biết origin của API.
  const providers = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/providers"));
  await page.goto("/login");
  const { google } = (await (await providers).json()) as { google: boolean };
  await expect(page.getByRole("link", { name: "Tiếp tục với Google" })).toHaveCount(google ? 1 : 0);
});

for (const mode of ["light", "dark"] as const) {
  test(`tương phản chữ đạt WCAG AA — /verify ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await register(page, `VerifyContrast${mode}`);
    await page.getByLabel("Mã xác thực").waitFor();
    await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);

    const clean = await auditText(page);
    expect(clean.checked, "không đo được node chữ nào — selector đã trượt").toBeGreaterThan(5);
    expect(clean.fails, `/verify (${mode}): ${clean.fails.join(" | ")}`).toEqual([]);

    await page.getByLabel("Mã xác thực").fill(VERIFICATION_CODE === "000000" ? "111111" : "000000");
    await page.getByText("Mã không đúng hoặc đã hết hạn").waitFor();
    const failed = await auditText(page);
    expect(failed.fails, `/verify lỗi (${mode}): ${failed.fails.join(" | ")}`).toEqual([]);
  });
}
