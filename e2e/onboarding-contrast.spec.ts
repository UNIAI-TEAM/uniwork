import { expect, test, type Page } from "@playwright/test";
import { registerVerified } from "./auth-nav";
import { auditText } from "./contrast";

/** Tương phản chữ của luồng onboarding. Phép đo ở `./contrast`. */
async function reach(page: Page, tag: string) {
  await registerVerified(page, tag);
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
    // `.dark` phải bật lại sau MỖI lần chuyển bước: class nằm trên <html> nhưng
    // điều hướng phía client dựng lại cây, và lần toggle trước không theo sang.
    await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
    const step2 = await auditText(page);
    expect(step2.fails, `bước "Tổ chức" (${mode}): ${step2.fails.join(" | ")}`).toEqual([]);

    // Bước 3 và 4 trước đây không được đo lần nào — mà bước Mời là nơi có nhiều
    // chữ phụ nhất (chip email, link mời mono, dòng "đã bỏ qua").
    const orgName = `Contrast${mode} ${Date.now()}`;
    await page.getByLabel("Tên tổ chức").fill(orgName);
    await page.getByRole("button", { name: `Tạo ${orgName}` }).click();
    await page.getByRole("heading", { name: "Đặt tên workspace." }).waitFor();
    await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
    const step3 = await auditText(page);
    expect(step3.fails, `bước "Workspace" (${mode}): ${step3.fails.join(" | ")}`).toEqual([]);

    await page.getByLabel("Tên workspace").fill("Đội Contrast");
    await page.getByRole("button", { name: "Tạo Đội Contrast" }).click();
    await page.getByRole("heading", { name: /Mời đồng nghiệp/ }).waitFor();
    await page.getByLabel("Email đồng nghiệp").fill("contrast@example.com");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Gửi lời mời" }).click();
    await page.getByRole("button", { name: "Sao chép" }).first().waitFor();
    await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
    const step4 = await auditText(page);
    expect(step4.fails, `bước "Mời" (${mode}): ${step4.fails.join(" | ")}`).toEqual([]);
  });
}
