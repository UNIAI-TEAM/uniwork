import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { verifyEmail } from "./auth-nav";
import type { WorkspaceSeed } from "./onboard";

const DOCUMENT_URL = /\/documents\/[0-9A-HJKMNP-TV-Z]{26}$/;

/** Screenshot helper bound to one evidence directory (created on first use). */
export function shooter(dir: string) {
  mkdirSync(dir, { recursive: true });
  return (page: Page, name: string) => page.screenshot({ path: resolve(dir, `${name}.png`) });
}

/**
 * Register -> verify -> org -> workspace -> skip invites, with the invite-step
 * retry `documents-comments.spec.ts` uses: the skip click can land while the
 * next route is still compiling.
 */
export async function onboardDocumentsUser(page: Page, w: WorkspaceSeed) {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(w.name);
  await page.getByLabel("Email").fill(w.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(w.orgName);
  await page.getByRole("button", { name: `Tạo ${w.orgName}` }).click();
  await page.getByLabel("Tên workspace").fill(w.wsName);
  await page.getByRole("button", { name: `Tạo ${w.wsName}` }).click();

  const workspaceUrl = new RegExp(`/${w.orgSlug}/${w.wsSlug}/tasks`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
    try {
      await page.waitForURL(workspaceUrl, { timeout: 30_000 });
      break;
    } catch {
      // Still on the invite step: the click raced the route compile.
    }
  }
  await expect(page).toHaveURL(workspaceUrl, { timeout: 120_000 });
  await page.getByRole("button", { name: "Để sau" }).click({ timeout: 30_000 });
}

/**
 * A second, independent session of an onboarded user. Copying storageState
 * would share the rotating refresh token, and the server's reuse detection
 * would then end the first session — so the second browser signs in itself.
 */
export async function signIn(page: Page, w: WorkspaceSeed) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(w.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

/** New page from the library, `text` typed and confirmed saved; returns its URL. */
export async function createPageWithText(page: Page, w: WorkspaceSeed, text: string): Promise<string> {
  await page.goto(`/${w.orgSlug}/${w.wsSlug}/documents`);
  await page.getByRole("button", { name: "Trang mới" }).first().click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });
  const surface = page.getByRole("textbox", { name: "Nội dung tài liệu" });
  await expect(surface).toBeVisible({ timeout: 60_000 });
  await surface.click();
  await page.keyboard.type(text);
  await expect(page.getByRole("status", { name: /^Đã lưu/ })).toBeVisible({ timeout: 30_000 });
  return page.url();
}

/** Opens the detail header's "more actions" menu and picks one entry. */
export async function documentAction(page: Page, name: string | RegExp) {
  await page.getByRole("button", { name: /Hành động khác|More actions/ }).click();
  await page.getByRole("menuitem", { name }).click();
}
