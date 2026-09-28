import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { createPageWithText, documentAction, onboardDocumentsUser, shooter } from "./documents-onboard";
import { workspaceSeed } from "./onboard";

/**
 * Lane g1-08 (UNI-682) AC-3: sharing on the real stack. The org admin turns
 * public links on in the documents settings tab, grants and revokes an
 * organization share, mints a public link whose URL is shown once, and an
 * anonymous second session reads the page through it; the access log records
 * the link view, and after the revoke the same URL answers the dead-link state.
 *
 * Needs: documents flag ON (`FF_DOCUMENTS=true`), Postgres + Redis up, this
 * worktree's migrations applied, web app on E2E_BASE_URL. Recipe:
 * reports/g1-08-versions-share-ui/serve.sh in the run folder.
 */
test.describe.configure({ timeout: 360_000 });

const seed = workspaceSeed("sharing", "links", Date.now());
const shot = shooter(
  process.env.DOCUMENT_SHOT_DIR ?? resolve(process.cwd(), "test-results", "documents-sharing-shots"),
);

function shareDialog(page: Page) {
  return page.getByRole("dialog", { name: /Chia sẻ tài liệu|Share document/ });
}

test("share, public link, anonymous read, access log and revoke", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboardDocumentsUser(page, seed);
  const docUrl = await createPageWithText(page, seed, "Nội dung công khai của trang");

  // Org settings: public links start closed; the admin opens them.
  await page.goto(`/${seed.orgSlug}/${seed.wsSlug}/settings?tab=documents`);
  const toggle = page.getByRole("switch", { name: "Liên kết công khai" });
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await expect(toggle).not.toBeChecked();
  await shot(page, "documents-settings-light-vi");
  await toggle.click();
  await expect(toggle).toBeChecked({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("switch", { name: "Liên kết công khai" })).toBeChecked({ timeout: 60_000 });

  // Organization share: granted, listed, revoked.
  await page.goto(docUrl);
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
  await documentAction(page, "Chia sẻ");
  const dialog = shareDialog(page);
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("Người và nhóm có quyền")).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("combobox", { name: "Đối tượng", exact: true }).click();
  await page.getByRole("option", { name: "Tổ chức" }).click();
  await dialog.getByRole("button", { name: "Chia sẻ", exact: true }).click();
  const revokeOrg = dialog.getByRole("button", { name: `Thu hồi ${seed.orgName}` });
  await expect(revokeOrg).toBeVisible({ timeout: 30_000 });

  // Public link: the raw URL is shown once.
  await dialog.getByRole("button", { name: "Tạo liên kết mới" }).click();
  const created = dialog.getByTestId("share-created-url");
  await expect(created).toBeVisible({ timeout: 30_000 });
  const linkUrl = (await created.textContent())?.trim() ?? "";
  expect(linkUrl).toMatch(/\/share\/[^/\s]+$/);
  const linkPath = new URL(linkUrl, "http://placeholder").pathname;
  await expect(dialog.getByText(/URL chỉ hiển thị lần này/)).toBeVisible();
  await shot(page, "share-dialog-light-vi");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(400); // let transition-colors settle before the shot
  await shot(page, "share-dialog-dark-vi");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  await revokeOrg.click();
  await expect(revokeOrg).toHaveCount(0, { timeout: 30_000 });
  await expect(dialog.getByText("Chủ sở hữu quyền")).toBeVisible();

  // Anonymous second session: no app session, only the token.
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(linkPath);
  await expect(visitor.getByText("Nội dung công khai của trang")).toBeVisible({ timeout: 60_000 });
  await expect(visitor.getByText("Chia sẻ qua liên kết công khai")).toBeVisible();
  await shot(visitor, "public-page-light-vi");
  await visitor.setViewportSize({ width: 390, height: 844 });
  await shot(visitor, "public-page-mobile-vi");

  // Reopening the dialog never shows the raw URL again.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await documentAction(page, "Chia sẻ");
  await expect(dialog.getByText("Liên kết công khai", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByTestId("share-created-url")).toHaveCount(0);

  // Revoke the link; the anonymous reader gets the dead-link state.
  await dialog.getByRole("region", { name: "Liên kết công khai" }).getByRole("button", { name: /^Thu hồi/ }).click();
  await expect(dialog.getByText("Chưa có liên kết nào.")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await visitor.reload();
  await expect(visitor.getByRole("heading", { name: "Liên kết không còn hiệu lực" })).toBeVisible({
    timeout: 60_000,
  });
  await shot(visitor, "public-page-revoked-mobile-vi");
  await anon.close();

  // Access log: the anonymous link view is recorded.
  await documentAction(page, "Nhật ký truy cập");
  const log = page.getByRole("dialog", { name: /Nhật ký truy cập/ });
  await expect(log.getByText("Mở qua liên kết").first()).toBeVisible({ timeout: 30_000 });
  await expect(log.getByText("Ẩn danh").first()).toBeVisible();
  await shot(page, "access-log-light-vi");
  await page.keyboard.press("Escape");

  // English copy of the share dialog.
  await page.getByRole("button", { name: "Ngôn ngữ" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({ timeout: 60_000 });
  await documentAction(page, "Share");
  await expect(shareDialog(page).getByText("Public links", { exact: true })).toBeVisible({ timeout: 30_000 });
  await shot(page, "share-dialog-light-en");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitemradio", { name: "Tiếng Việt" }).click();
  await page.reload();

  // Mobile share dialog.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
  await documentAction(page, "Chia sẻ");
  await expect(shareDialog(page).getByText("Người và nhóm có quyền")).toBeVisible({ timeout: 30_000 });
  await shot(page, "share-dialog-mobile-vi");
});
