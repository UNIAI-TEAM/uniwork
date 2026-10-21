import { expect, test, type Page } from "@playwright/test";
import { contentRow } from "./documents-folders-fixtures";
import { onboardDocumentsUser } from "./documents-onboard";
import { libraryAccessPill } from "./documents-share-fixtures";
import { workspaceSeed } from "./onboard";

/**
 * UNI-2038 (G4): sharing moved out of the quick-create strip into the first-save
 * dialog. A blank docx made from its quick-create pill is private; the first Save
 * opens "Đặt tên tài liệu", and its "Chia sẻ với workspace" switch writes the title
 * and the workspace visibility in one PATCH. After a reload the row in Thư mục của tôi reads as
 * shared with the workspace, which only holds if the server accepted `visibility` on
 * a My Folder blank (the unit tests run against a mocked transport).
 *
 * Needs the Docs frame bundle in the web build, like office-docs-web.spec.ts: run
 * with OFFICE_DOCS_WEB_E2E=1 by the cloud runner, not locally.
 */
test.describe.configure({ timeout: 240_000 });
test.skip(process.env.OFFICE_DOCS_WEB_E2E !== "1", "Set OFFICE_DOCS_WEB_E2E=1 to run the Docs frame specs.");

const stamp = Date.now();
const DOCUMENT_URL = /\/documents\/[0-9A-HJKMNP-TV-Z]{26}$/;
const FRAME_SELECTOR = 'iframe[src*="/office-frame/docs/"]';
const EDITOR = '.ProseMirror[contenteditable="true"]';
const owner = workspaceSeed("fsshare", "owner", stamp);

function quickCreate(page: Page, label: RegExp) {
  return page.getByRole("region", { name: "Tạo nhanh" }).getByRole("button", { name: label });
}

test("the first-save share switch makes the new document shared with the workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboardDocumentsUser(page, owner);
  await page.goto(`/${owner.orgSlug}/${owner.wsSlug}/documents`);
  await expect(quickCreate(page, /^Văn bản/)).toBeVisible({ timeout: 60_000 });
  await quickCreate(page, /^Văn bản/).click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 90_000 });

  // An edit in the frame, then Save: the page asks for a name before anything uploads.
  const editor = page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first();
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await editor.click();
  await page.keyboard.type(`Nội dung ${stamp}`);
  await page.keyboard.press("Control+s");

  const dialog = page.getByRole("dialog", { name: "Đặt tên tài liệu" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const title = `Kế hoạch chia sẻ ${stamp.toString(36)}`;
  await dialog.getByLabel("Tên tài liệu").fill(title);
  const toggle = dialog.getByRole("switch", { name: "Chia sẻ với workspace" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Lưu" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // After a reload the document sits in Thư mục của tôi (a blank is created in My
  // Folder, not at the workspace root, so the home root never lists it) and its row
  // reads Workspace in the access pill.
  await page.goto(`/${owner.orgSlug}/${owner.wsSlug}/documents`);
  await page
    .getByRole("navigation", { name: "Điều hướng tài liệu" })
    .getByRole("treeitem", { name: /^Thư mục của tôi/ })
    .getByText("Thư mục của tôi", { exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Thư mục của tôi", exact: true })).toBeVisible({ timeout: 30_000 });
  const row = contentRow(page, title);
  await expect(row).toBeVisible({ timeout: 60_000 });
  const pill = libraryAccessPill(row);
  await expect(pill).toHaveAttribute("data-access-kind", "workspace", { timeout: 60_000 });
  await expect(pill).toHaveText("Workspace");
});
