import { expect, test, type Page } from "@playwright/test";

// Cột onboarding là một thước đo; mọi khối cấu trúc bên trong phải chạy đúng bề
// rộng đó (bắt lỗi form tự đặt max-width hẹp hơn heading). Kiểm tra geometry
// render, không phải class.
test.use({ viewport: { width: 1440, height: 900 } });

async function registerAndStart(page: Page, tag: string) {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(tag);
  await page.getByLabel("Email").fill(`${tag.toLowerCase()}-${stamp}@example.com`);
  await page.getByLabel("Mật khẩu").fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByText("Cho chúng tôi biết đôi chút về bạn.").waitFor();
  return stamp;
}

async function expectFullWidthBlocks(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const column = document.querySelector<HTMLElement>("main > div");
    if (!column) return null;
    const columnRect = column.getBoundingClientRect();
    const selector = 'h1, [data-slot="field-group"], [data-slot="field"]';
    const offenders: Array<{ tag: string; w: number; text: string }> = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (Math.abs(r.width - columnRect.width) > 1) {
        offenders.push({ tag: el.tagName.toLowerCase(), w: Math.round(r.width), text: (el.textContent ?? "").trim().slice(0, 40) });
      }
    }
    return { columnWidth: Math.round(columnRect.width), offenders };
  });
  expect(result, `${label}: no onboarding column found`).not.toBeNull();
  expect(result!.offenders, `${label}: blocks not matching the ${result!.columnWidth}px column`).toEqual([]);
}

test("onboarding — structural blocks match the column width on every step", async ({ page }) => {
  const stamp = await registerAndStart(page, "Widths");
  await expectFullWidthBlocks(page, "about you");

  await page.getByRole("radio", { name: "Kỹ sư / phát triển" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("heading", { name: "Đặt tên tổ chức của bạn." }).waitFor();
  await expectFullWidthBlocks(page, "organization");

  await page.getByLabel("Tên tổ chức").fill(`Widths ${stamp}`);
  await page.getByRole("button", { name: /^Tạo Widths/ }).click();
  await page.getByRole("heading", { name: "Đặt tên workspace." }).waitFor();
  await expectFullWidthBlocks(page, "workspace");

  await page.getByLabel("Tên workspace").fill("Đội Widths");
  await page.getByRole("button", { name: "Tạo Đội Widths" }).click();
  await page.getByRole("heading", { name: /Mời đồng nghiệp/ }).waitFor();
  await expectFullWidthBlocks(page, "invite");
});

test("onboarding — the shell survives step changes instead of re-mounting", async ({ page }) => {
  await registerAndStart(page, "Shell");
  await page.evaluate(() => {
    document.querySelector("aside")?.setAttribute("data-persist-probe", "1");
    document.querySelector("main")?.setAttribute("data-persist-probe", "1");
  });
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByRole("heading", { name: "Đặt tên tổ chức của bạn." }).waitFor();
  await expect(page.locator("aside[data-persist-probe]")).toHaveCount(1);
  await expect(page.locator("main[data-persist-probe]")).toHaveCount(1);
});
