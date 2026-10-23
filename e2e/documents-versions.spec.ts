import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { createPageWithText, documentAction, onboardDocumentsUser, shooter, signIn } from "./documents-onboard";
import { workspaceSeed } from "./onboard";

/**
 * Lane g1-08 (UNI-682) AC-3: version history on the real stack. A named
 * checkpoint is created from the working copy, the page changes, and restoring
 * the checkpoint moves the working copy back only after the server answers;
 * a second session of the same user sees the restored content after a reload.
 *
 * Needs: documents flag ON (`FF_DOCUMENTS=true`), Postgres + Redis up, this
 * worktree's migrations applied, web app on E2E_BASE_URL. Recipe:
 * reports/g1-08-versions-share-ui/serve.sh in the run folder.
 */
test.describe.configure({ timeout: 360_000 });

const seed = workspaceSeed("versions", "history", Date.now());
const shot = shooter(
  process.env.DOCUMENT_SHOT_DIR ?? resolve(process.cwd(), "test-results", "documents-versions-shots"),
);

function historySheet(page: Page) {
  return page.getByRole("dialog", { name: /Lịch sử phiên bản|Version history/ });
}

test("version checkpoint restores the working copy and a second session sees it", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboardDocumentsUser(page, seed);
  const docUrl = await createPageWithText(page, seed, "Bản gốc của tài liệu");

  // Named checkpoint of the working copy.
  await documentAction(page, "Lịch sử phiên bản");
  const sheet = historySheet(page);
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await sheet.getByLabel("Tên mốc").fill("Trước khi sửa");
  await sheet.getByRole("button", { name: "Tạo mốc" }).click();
  const done = page.getByText(/^Đã tạo phiên bản \d+$/);
  await expect(done).toBeVisible({ timeout: 30_000 });
  const checkpointNo = Number((await done.textContent())?.match(/\d+/)?.[0]);
  expect(checkpointNo).toBeGreaterThan(0);
  await expect(sheet.getByText("Trước khi sửa")).toBeVisible({ timeout: 30_000 });
  await shot(page, "versions-sheet-light-vi");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(400); // let transition-colors settle before the shot
  await shot(page, "versions-sheet-dark-vi");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Change the working copy after the checkpoint.
  const surface = page.getByRole("textbox", { name: "Nội dung tài liệu" });
  await surface.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" sửa sau mốc");
  await expect(page.getByRole("status", { name: /^Đã lưu/ })).toBeVisible({ timeout: 30_000 });
  await expect(surface).toContainText("sửa sau mốc");

  // Second session of the same user: sees the edit before the restore.
  const other = await browser.newContext();
  const second = await other.newPage();
  await signIn(second, seed);
  await second.goto(docUrl);
  const secondSurface = second.getByRole("textbox", { name: "Nội dung tài liệu" });
  await expect(secondSurface).toContainText("sửa sau mốc", { timeout: 60_000 });

  // Restore the checkpoint: the confirm dialog waits for the server answer.
  await documentAction(page, "Lịch sử phiên bản");
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await sheet.getByRole("button", { name: `Khôi phục phiên bản ${checkpointNo}`, exact: true }).click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: `Khôi phục phiên bản ${checkpointNo}?` }));
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Khôi phục", exact: true }).click();
  await expect(confirm).toBeHidden({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(surface).not.toContainText("sửa sau mốc", { timeout: 30_000 });
  await expect(surface).toContainText("Bản gốc của tài liệu");

  // The server is the source of truth: both sessions read the restored copy.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toContainText("Bản gốc của tài liệu", {
    timeout: 60_000,
  });
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).not.toContainText("sửa sau mốc");
  await second.reload();
  await expect(secondSurface).toContainText("Bản gốc của tài liệu", { timeout: 60_000 });
  await expect(secondSurface).not.toContainText("sửa sau mốc");
  await other.close();

  // History keeps every row: the checkpoint and the restore version.
  await documentAction(page, "Lịch sử phiên bản");
  await expect(sheet.getByText(`Phiên bản ${checkpointNo + 1}`)).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText(`Phiên bản ${checkpointNo}`, { exact: true })).toBeVisible();

  // English copy of the same sheet.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ngôn ngữ" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({ timeout: 60_000 });
  await documentAction(page, "Version history");
  await expect(historySheet(page).getByText(`Version ${checkpointNo + 1}`)).toBeVisible({ timeout: 30_000 });
  await shot(page, "versions-sheet-light-en");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitemradio", { name: "Tiếng Việt" }).click();
  await page.reload();

  // Mobile: the sheet fills the viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
  await documentAction(page, "Lịch sử phiên bản");
  await expect(historySheet(page).getByText(`Phiên bản ${checkpointNo + 1}`)).toBeVisible({ timeout: 30_000 });
  await shot(page, "versions-sheet-mobile-vi");
});
