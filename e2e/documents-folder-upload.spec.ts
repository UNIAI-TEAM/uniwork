import { expect, test, type Page } from "@playwright/test";
import { createFolder, folderCard, getDocument, listDocuments } from "./documents-folders-fixtures";
import {
  dropFolder,
  EXPECTED_FILES,
  EXPECTED_FOLDERS,
  expectDoneToast,
  folderDialog,
  gotoTarget,
  libraryRows,
  lowerFolderUploadLimits,
  openTarget,
  pickFolder,
  preflightDialog,
  readLanded,
  readTree,
  seedUploadScene,
  shareSwitch,
  stemOf,
  submitButton,
  targetFolders,
  TREE_NAME,
  uploadMenuButton,
  type UploadScene,
} from "./documents-folder-upload-fixtures";

/**
 * UNI-2052: folder upload and multi-file upload on the Documents library.
 *
 * Written ahead of the integration: the server half (folder-uploads routes,
 * `documents.limits.folder_upload` in GET /config) and the views fixes land
 * from other branches, so these specs first run on the cloud runner once those
 * are merged. They share the fixture tree under e2e/fixtures/folder-upload/
 * (3 levels, 4 uploadable files, one hidden and one unsupported file).
 * Every test seeds its own workspace and uploads into its own folder.
 */
test.describe.configure({ timeout: 240_000 });

const SKIPPED_TITLE = "Bỏ qua 2 tệp";

/** The tree under the top folder, as the planner must have uploaded it. */
function expectFullTree(landed: Awaited<ReturnType<typeof readLanded>>, visibility: { folders: string; files: string }) {
  expect([...landed.folders.keys()].sort()).toEqual([...EXPECTED_FOLDERS].sort());
  expect([...landed.files.keys()].sort()).toEqual([...EXPECTED_FILES].sort());
  for (const value of landed.folders.values()) expect(value).toBe(visibility.folders);
  for (const value of landed.files.values()) expect(value).toBe(visibility.files);
}

async function runPickedFolder(page: Page, expectedTitle: string) {
  const dialog = folderDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("folder-upload-root")).toHaveText(expectedTitle);
  await submitButton(dialog).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expectDoneToast(page, EXPECTED_FILES.length, expectedTitle);
}

test("FU-01 a picked 3-level folder shows its pre-flight, uploads private, lands as 3 levels, and a second upload becomes (1)", async ({
  page,
}) => {
  test.slow();
  const scene = await seedUploadScene(page, "fu-pick");
  await openTarget(page, scene);

  await pickFolder(page);
  const dialog = folderDialog(page);
  await expect(dialog.getByTestId("folder-upload-root")).toHaveText(TREE_NAME);
  await expect(dialog.getByTestId("folder-upload-destination")).toHaveText(scene.target.title);
  await expect(dialog.getByTestId("folder-upload-summary")).toContainText(new RegExp(`^${EXPECTED_FILES.length} tệp ·`));
  // The hidden file and the unsupported file are skipped, each under its own reason.
  await expect(dialog.getByRole("heading", { level: 3, name: SKIPPED_TITLE })).toBeVisible();
  await expect(dialog.getByText("Tệp ẩn hoặc tệp hệ thống · 1")).toBeVisible();
  await expect(dialog.getByText("Định dạng chưa được hỗ trợ · 1")).toBeVisible();
  await expect(dialog.getByTestId("folder-upload-refusal")).toHaveCount(0);
  await expect(dialog.getByTestId("folder-upload-renamed")).toHaveCount(0);
  const share = shareSwitch(dialog);
  await expect(share).toHaveAttribute("aria-checked", "false");

  await submitButton(dialog).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expectDoneToast(page, EXPECTED_FILES.length, TREE_NAME);

  // The library shows the top folder; open it and walk the three levels.
  await expect(folderCard(page, TREE_NAME)).toBeVisible({ timeout: 60_000 });
  await folderCard(page, TREE_NAME).getByRole("button").first().click();
  await expect(page).toHaveURL(/folder=[0-9A-HJKMNP-TV-Z]{26}/);
  await expect(folderCard(page, "Hop dong")).toBeVisible({ timeout: 60_000 });
  await expect(libraryRows(page, "tong-quan")).toHaveCount(1);
  await folderCard(page, "Hop dong").getByRole("button").first().click();
  await expect(folderCard(page, "2026")).toBeVisible({ timeout: 60_000 });
  await expect(libraryRows(page, "mau-hop-dong")).toHaveCount(1);
  await folderCard(page, "2026").getByRole("button").first().click();
  await expect(libraryRows(page, "bao-gia")).toHaveCount(1);
  await expect(libraryRows(page, "ke-hoach")).toHaveCount(1);
  await expect(libraryRows(page, "hidden-notes")).toHaveCount(0);
  await expect(libraryRows(page, "skip-me")).toHaveCount(0);

  // The API holds the same tree: skipped files absent, everything private.
  const [first] = await targetFolders(page, scene);
  expect(first?.title).toBe(TREE_NAME);
  expectFullTree(await readLanded(page, scene, first!.id), { folders: "restricted", files: "restricted" });

  // The same folder again is never merged: it becomes "Ho so 2052 (1)" with its own full tree.
  await gotoTarget(page, scene);
  await pickFolder(page);
  const again = folderDialog(page);
  await expect(again.getByTestId("folder-upload-renamed")).toContainText(`"${TREE_NAME} (1)"`);
  await runPickedFolder(page, `${TREE_NAME} (1)`);

  const folders = await targetFolders(page, scene);
  expect(folders.map((f) => f.title).sort()).toEqual([TREE_NAME, `${TREE_NAME} (1)`]);
  for (const folder of folders) {
    expectFullTree(await readLanded(page, scene, folder.id), { folders: "restricted", files: "restricted" });
  }
});

test("FU-02 the share switch applies to every file of the run and leaves the folders private", async ({ page }) => {
  test.slow();
  const scene = await seedUploadScene(page, "fu-share");
  await openTarget(page, scene);

  await pickFolder(page);
  const dialog = folderDialog(page);
  const share = shareSwitch(dialog);
  await expect(share).toHaveAttribute("aria-checked", "false");
  await share.click();
  await expect(share).toHaveAttribute("aria-checked", "true");
  await submitButton(dialog).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expectDoneToast(page, EXPECTED_FILES.length, TREE_NAME);

  const [top] = await targetFolders(page, scene);
  expectFullTree(await readLanded(page, scene, top!.id), { folders: "restricted", files: "workspace" });
});

test("FU-03 a run over the file limit is refused in the pre-flight with the numbers and sends nothing", async ({
  page,
}) => {
  const scene = await seedUploadScene(page, "fu-limit");
  // The fixture holds 4 uploadable files; a limit of 2 refuses it the way 612 files refuse at 500.
  await lowerFolderUploadLimits(page, { max_files: 2 });
  await openTarget(page, scene);

  const plans: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/documents\/folder-uploads(\?|$)/.test(request.url())) plans.push(request.url());
  });

  await pickFolder(page);
  const dialog = folderDialog(page);
  const refusal = dialog.getByTestId("folder-upload-refusal");
  await expect(refusal).toContainText("Chưa tải lên được thư mục này");
  await expect(refusal).toContainText(`${EXPECTED_FILES.length} tệp — tối đa 2`);
  await expect(dialog.getByTestId("folder-upload-summary")).toHaveCount(0);
  await expect(shareSwitch(dialog)).toHaveCount(0);

  // The button is aria-disabled: it stays focusable and does nothing. Playwright will not click an
  // aria-disabled element, so the click is forced (and Enter pressed) to prove the JS guard holds.
  const submit = submitButton(dialog);
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await submit.click({ force: true });
  await submit.press("Enter");
  const until = Date.now() + 1_500;
  while (Date.now() < until) {
    await expect(dialog).toBeVisible();
    expect(plans).toEqual([]);
    await page.waitForTimeout(200);
  }

  await dialog.getByRole("button", { name: "Hủy" }).click();
  await expect(dialog).toBeHidden();
  expect(await targetFolders(page, scene)).toEqual([]);
});

test("FU-04 a dropped folder reads through the entry API, skips hidden and unsupported files, and uploads as 3 levels", async ({
  page,
}) => {
  test.slow();
  const scene = await seedUploadScene(page, "fu-drop");
  await openTarget(page, scene);

  await dropFolder(page, readTree());
  const dialog = folderDialog(page);
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByTestId("folder-upload-root")).toHaveText(TREE_NAME);
  await expect(dialog.getByTestId("folder-upload-destination")).toHaveText(scene.target.title);
  await expect(dialog.getByTestId("folder-upload-summary")).toContainText(new RegExp(`^${EXPECTED_FILES.length} tệp ·`));
  await expect(dialog.getByRole("heading", { level: 3, name: SKIPPED_TITLE })).toBeVisible();
  await expect(dialog.getByText("Tệp ẩn hoặc tệp hệ thống · 1")).toBeVisible();
  await expect(dialog.getByText("Định dạng chưa được hỗ trợ · 1")).toBeVisible();
  await expect(shareSwitch(dialog)).toHaveAttribute("aria-checked", "false");

  await submitButton(dialog).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expectDoneToast(page, EXPECTED_FILES.length, TREE_NAME);
  await expect(folderCard(page, TREE_NAME)).toBeVisible({ timeout: 60_000 });

  const [top] = await targetFolders(page, scene);
  expect(top?.title).toBe(TREE_NAME);
  expectFullTree(await readLanded(page, scene, top!.id), { folders: "restricted", files: "restricted" });
});

// Files-mode copy and test ids come from the views fixes (branch feature/UNI-2052-views-fx), which this lane does not
// have yet: the pre-flight is found by its summary line (shared with folder mode), the missing root line is the
// files-mode marker, and the toast names the destination folder (contract §10 A7).
test("FU-05 several files go through the files-mode pre-flight straight into the open folder, same names both kept", async ({
  page,
}) => {
  test.slow();
  const scene = await seedUploadScene(page, "fu-multi");
  await openTarget(page, scene);

  await uploadMenuButton(page).click();
  await page.getByRole("menuitem", { name: "Tải lên tệp" }).click();
  const picker = page.getByRole("dialog", { name: "Tải tệp lên" });
  await expect(picker).toBeVisible();
  const text = (body: string) => ({ name: "bien-ban.txt", mimeType: "text/plain", buffer: Buffer.from(body) });
  await picker.getByLabel("Chọn tệp").setInputFiles([
    text("lan mot"),
    text("lan hai"),
    { name: "ghi-chu.md", mimeType: "text/markdown", buffer: Buffer.from("# Ghi chu\n") },
  ]);

  const dialog = preflightDialog(page);
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByTestId("folder-upload-summary")).toContainText(/^3 tệp ·/);
  // No top folder in this mode: no root line, no "(n)" note, nothing skipped.
  await expect(dialog.getByTestId("folder-upload-root")).toHaveCount(0);
  await expect(dialog.getByTestId("folder-upload-renamed")).toHaveCount(0);
  await expect(dialog.getByTestId("folder-upload-refusal")).toHaveCount(0);
  await expect(shareSwitch(dialog)).toHaveAttribute("aria-checked", "false");
  await submitButton(dialog).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expectDoneToast(page, 3, scene.target.title);

  // Straight into the open folder, no folder created, and the two equal names keep their names (no "(n)").
  await expect(libraryRows(page, "bien-ban")).toHaveCount(2, { timeout: 60_000 });
  await expect(libraryRows(page, "ghi-chu")).toHaveCount(1);
  const { documents } = await listDocuments(page, scene.owner.token, scene.wsId, {
    parent_id: scene.target.id,
    limit: 200,
  });
  expect(documents.filter((d) => d.kind === "folder")).toEqual([]);
  expect(documents.map((d) => stemOf(d.title)).sort()).toEqual(["bien-ban", "bien-ban", "ghi-chu"]);
  expect(documents.every((d) => !/\(\d+\)/.test(d.title))).toBe(true);
  expect(documents.every((d) => d.visibility === "restricted")).toBe(true);
});

test("FU-05b exactly one picked file keeps the single-file dialog and opens the document", async ({ page }) => {
  const scene = await seedUploadScene(page, "fu-single");
  await openTarget(page, scene);

  await uploadMenuButton(page).click();
  await page.getByRole("menuitem", { name: "Tải lên tệp" }).click();
  const picker = page.getByRole("dialog", { name: "Tải tệp lên" });
  await picker.getByLabel("Chọn tệp").setInputFiles({
    name: "mot-tep.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("chi mot tep"),
  });
  await expect(picker.getByText("Đã chọn mot-tep.txt")).toBeVisible();
  await expect(preflightDialog(page)).toHaveCount(0);

  await submitButton(picker).click();
  await expect(picker).toBeHidden({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/documents\/[0-9A-HJKMNP-TV-Z]{26}$/, { timeout: 60_000 });
  const docId = page.url().split("/documents/")[1]!.split(/[?#]/)[0]!;
  const detail = await getDocument(page, scene.owner.token, docId);
  expect(detail.data?.parent_id).toBe(scene.target.id);
});

// UNI-2055 (workspace-public folders) will give a real "can view, cannot edit" folder; until then no
// read-only folder can be seeded (grantDocumentShare on a folder answers 422 folder_not_shareable,
// UNI-1974), so this holds the nearest case: a folder the member cannot reach at all.
test("FU-06 a member without access to the folder gets no upload entry, folder or file", async ({ page }) => {
  const scene = await seedUploadScene(page, "fu-noaccess", { withMemberB: true });
  const member = scene.member!;
  // The owner's target folder is private. The member's own folder is the positive control.
  const own = await createFolder(page, member.token, scene.wsId, "Của thành viên");
  const sceneOf = (folder: { id: string; title: string }): UploadScene => ({ ...scene, target: { id: folder.id, title: folder.title } });

  // Control: the same drop, as the same member, on their own folder opens the pre-flight. It proves
  // dropFolder reaches the flow and how long the dialog takes to appear.
  await openTarget(page, sceneOf(own), member.email);
  const dropped = Date.now();
  await dropFolder(page, readTree());
  await expect(preflightDialog(page)).toBeVisible({ timeout: 30_000 });
  const controlMs = Date.now() - dropped;
  await preflightDialog(page).getByRole("button", { name: "Hủy" }).click();
  await expect(preflightDialog(page)).toBeHidden();

  // The owner's folder: the page cannot read it (folderInvalid), so it shows the "cannot open" state
  // instead of the library, and neither the Upload menu nor "Tạo mới" is on the page.
  await page.goto(`/${scene.orgSlug}/${scene.wsSlug}/documents?folder=${scene.target.id}`);
  await expect(page.getByRole("alert").filter({ hasText: "Không mở được thư mục này" })).toBeVisible({ timeout: 60_000 });
  // The drop zone is still mounted (dropFolder targets it), so a no-op drop below is a real result.
  await expect(page.getByRole("region", { name: "Tài liệu", exact: true })).toBeVisible();
  await expect(uploadMenuButton(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tạo mới", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Tải lên thư mục" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Tải lên tệp" })).toHaveCount(0);

  // A dropped folder does nothing here: no pre-flight for at least twice as long as the control
  // needed, and nothing created in the owner's folder.
  await dropFolder(page, readTree());
  const until = Date.now() + Math.max(2 * controlMs, 3_000);
  while (Date.now() < until) {
    await expect(preflightDialog(page)).toHaveCount(0);
    await page.waitForTimeout(200);
  }
  const { documents } = await listDocuments(page, scene.owner.token, scene.wsId, { parent_id: scene.target.id });
  expect(documents).toEqual([]);
});
