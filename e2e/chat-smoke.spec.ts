import { expect, test } from "@playwright/test";
import { registerVerified } from "./auth-nav";

/** C-13.10 / UNI-516: browser smoke for workspace chat send + list. */
const stamp = Date.now();
const orgSlug = `chat-smoke-${stamp}`;
const orgName = `Chat Smoke ${stamp}`;
const wsSlug = `team-${stamp}`;
const wsName = `Team ${stamp}`;

test("workspace chat sends and shows a text message", async ({ page }) => {
  test.setTimeout(120_000);
  await registerVerified(page, "smoke-chat", stamp);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("radio", { name: "Kỹ sư / phát triển" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByLabel("Tên tổ chức").fill(orgName);
  await expect(page.getByLabel("Đường dẫn")).toHaveValue(orgSlug);
  await page.getByRole("button", { name: `Tạo ${orgName}` }).click();
  await page.getByLabel("Tên workspace").fill(wsName);
  await expect(page.getByLabel("Đường dẫn")).toHaveValue(wsSlug);
  await page.getByRole("button", { name: `Tạo ${wsName}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/`), { timeout: 30_000 });

  await page.goto(`/${orgSlug}/${wsSlug}/chat`);
  const composer = page.getByPlaceholder("Nhập tin nhắn…");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  const body = `smoke ${stamp}`;
  await composer.fill(body);
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.locator('article[id^="chat-msg-"]').filter({ hasText: body })).toBeVisible({
    timeout: 20_000,
  });
});
