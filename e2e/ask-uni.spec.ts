import { expect, test, type Page } from "@playwright/test";
import { VERIFICATION_CODE, verifyEmail } from "./auth-nav";

// The golden path for F-09 (spec §8): A creates a task, opens Ask UNI with
// ⌘J and asks about it; the answer cites [S1] as a link to that task. B, in a
// different organization, asks the same thing and gets no source at all —
// the context builder only ever reads as the asker.
//
// Requires `make dev` with AI_PROVIDER=fake (or a real key). Without a
// provider the topbar has no "Hỏi UNI" button and the spec skips itself.
const stamp = Date.now();

async function onboard(page: Page, tag: string, orgName: string, wsName: string) {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(tag);
  await page.getByLabel("Email").fill(`${tag.toLowerCase().replace(/\s+/g, "-")}-${stamp}@example.com`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page, VERIFICATION_CODE);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(orgName);
  await page.getByRole("button", { name: `Tạo ${orgName}` }).click();
  await page.getByLabel("Tên workspace").fill(wsName);
  await page.getByRole("button", { name: `Tạo ${wsName}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(/\/tasks$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Đã hiểu" }).click({ timeout: 15_000 });
}

async function ask(page: Page, question: string) {
  await page.keyboard.press("ControlOrMeta+j");
  const dialog = page.getByRole("dialog", { name: "Hỏi UNI" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Hỏi UNI…" }).fill(question);
  await dialog.getByRole("button", { name: "Hỏi" }).click();
  return dialog;
}

test("⌘J answers from the asker's own workspace only", async ({ browser, page: a }) => {
  await onboard(a, "Chủ Nhóm", `Alpha ${stamp}`, "Đội Alpha");
  const askButton = a.getByRole("button", { name: /Hỏi UNI/ });
  test.skip(!(await askButton.isVisible().catch(() => false)), "AI provider not configured on this server");

  const title = `Việc cho UNI ${stamp}`;
  await a.getByRole("button", { name: "Tạo việc" }).click();
  await a.getByLabel("Tiêu đề").fill(title);
  await a.getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(a.getByText(title)).toBeVisible();

  const dialog = await ask(a, `việc cho UNI ${stamp} thế nào?`);
  const source = dialog.getByRole("link", { name: /\[S1\]/ });
  await expect(source).toBeVisible({ timeout: 15_000 });
  await expect(source).toHaveAttribute("href", /\/tasks\/[0-9A-Z]+$/);
  await expect(dialog.getByText(/token vào/)).toBeVisible();

  // B: own organization, same question, nothing of A's comes back.
  const ctx = await browser.newContext({ locale: "vi-VN" });
  const b = await ctx.newPage();
  await onboard(b, "Người Khác", `Beta ${stamp}`, "Đội Beta");
  const dialogB = await ask(b, `việc cho UNI ${stamp} thế nào?`);
  await expect(dialogB.getByText("Chưa đủ dữ liệu trong workspace để trả lời.")).toBeVisible({ timeout: 15_000 });
  await expect(dialogB.getByRole("link", { name: /\[S1\]/ })).toHaveCount(0);
  await ctx.close();
});
