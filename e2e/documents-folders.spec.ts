import { expect, test } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import {
  apiCreateDocument,
  archiveDocument,
  createFolder,
  createFolderChain,
  createPage,
  getArchiveImpact,
  getDocument,
  getDocumentTree,
  grantDocumentShare,
  listDocuments,
  loginFolderUser,
  moveDocument,
  patchDocument,
  readDocumentArtifacts,
  restoreDocument,
  seedDocumentArtifacts,
  seedFolderSubtreeBatch,
  seedFolderWorkspace,
  skipWithoutFd09,
  uploadFixtureFile,
} from "./documents-folders-fixtures";

test("FD-A01 create folder from sidebar +, Mới menu, and tree row menu; rejects blank, >200 chars, and duplicate sibling names", async ({
  page,
}) => {
  test.slow();
  const ws = await seedFolderWorkspace(page, "fd-a01");
  await uploadFixtureFile(page, ws.owner.token, ws.wsId, "fx-docx-report-vi");
  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);

  const sidebar = page.getByRole("navigation", { name: "Điều hướng tài liệu" });
  const tree = sidebar.getByRole("tree", { name: "Cây tài liệu" });
  await sidebar.getByRole("button", { name: "Tạo thư mục" }).click();

  const dialog = page.getByRole("dialog", {
    name: "Thư mục mới ở Documents (gốc)",
  });
  const input = dialog.getByLabel("Tên thư mục");
  await expect(input).toBeVisible();

  await input.fill("   ");
  await dialog.getByRole("button", { name: "Tạo" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Nhập tên thư mục.");

  const over200 = "K".repeat(201);
  await input.fill(over200);
  await dialog.getByRole("button", { name: "Tạo" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Tên thư mục tối đa 200 ký tự.",
  );
  const apiTooLong = await apiCreateDocument(page, ws.owner.token, ws.wsId, {
    title: over200,
    kind: "folder",
  });
  expect(apiTooLong.status).toBe(400);

  await input.fill("Hợp đồng 2026");
  await input.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Đã tạo thư mục Hợp đồng 2026")).toBeVisible();
  await expect(
    tree.getByRole("treeitem", { name: "Hợp đồng 2026" }),
  ).toBeVisible();

  const rootList = await listDocuments(page, ws.owner.token, ws.wsId, {
    parent_id: "",
  });
  const rootFolder = rootList.documents.find(
    (d) => d.title === "Hợp đồng 2026",
  );
  expect(rootFolder?.kind).toBe("folder");
  expect(rootFolder?.parent_id).toBeNull();

  await sidebar.getByRole("button", { name: "Tạo thư mục" }).click();
  await input.fill("  hop   dong 2026 ");
  await dialog.getByRole("button", { name: "Tạo" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Đã có thư mục tên này ở đây. Hãy đặt tên khác.",
  );
  await expect(input).toHaveValue("  hop   dong 2026 ");
  await input.press("Escape");
  await expect(dialog).toBeHidden();

  await tree.getByRole("treeitem", { name: "Hợp đồng 2026" }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${rootFolder!.id}`));
  await page.getByRole("button", { name: "Tạo mới", exact: true }).click();
  await page.getByRole("menuitem", { name: "Thư mục" }).click();
  const subDialog = page.getByRole("dialog", {
    name: "Thư mục con mới trong Hợp đồng 2026",
  });
  await subDialog.getByLabel("Tên thư mục").fill("Phụ lục Q1");
  await subDialog.getByRole("button", { name: "Tạo" }).click();
  await expect(subDialog).toBeHidden();
  await expect(
    page
      .getByRole("table", { name: "Tài liệu" })
      .getByRole("button", { name: /^Phụ lục Q1/ }),
  ).toBeVisible();

  await tree
    .getByRole("button", { name: "Thao tác cho Hợp đồng 2026" })
    .click();
  await page.getByRole("menuitem", { name: "Thư mục con mới" }).click();
  await subDialog.getByLabel("Tên thư mục").fill("Biên bản");
  await subDialog.getByRole("button", { name: "Tạo" }).click();
  await expect(
    tree.getByRole("treeitem", { name: "Biên bản" }),
  ).toBeVisible();
  const children = await listDocuments(page, ws.owner.token, ws.wsId, {
    parent_id: rootFolder!.id,
  });
  expect(children.documents.map((d) => d.title).sort()).toEqual([
    "Biên bản",
    "Phụ lục Q1",
  ]);
});

test("FD-A02 sidebar folder tree expands/collapses, persists across reload, syncs active folder, and keeps folders_only", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a02");
  const parent = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Dự án Alpha",
  );
  const child = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thiết kế",
    parent.id,
  );
  await createPage(page, ws.owner.token, ws.wsId, "Trang Ghi chú", parent.id);
  await uploadFixtureFile(page, ws.owner.token, ws.wsId, "fx-docx-report-vi", {
    parentId: parent.id,
    title: "Báo cáo Đính kèm",
  });

  const treeNodes = await getDocumentTree(page, ws.owner.token, ws.wsId, {
    folders_only: true,
  });
  expect(treeNodes.every((n) => n.kind === "folder")).toBe(true);
  expect(treeNodes[0]?.children.every((n) => n.kind === "folder")).toBe(true);

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);

  const tree = page.getByRole("tree", { name: "Cây tài liệu" });
  const parentItem = tree.getByRole("treeitem", { name: "Dự án Alpha" });
  await expect(parentItem).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Thiết kế" })).toBeHidden();

  await tree.getByRole("button", { name: "Mở rộng Dự án Alpha" }).click();
  const childItem = tree.getByRole("treeitem", { name: "Thiết kế" });
  await expect(childItem).toBeVisible();
  await expect(
    tree.getByRole("treeitem", { name: "Trang Ghi chú" }),
  ).toHaveCount(0);
  await expect(
    tree.getByRole("treeitem", { name: "Báo cáo Đính kèm" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(tree.getByRole("treeitem", { name: "Thiết kế" })).toBeVisible();

  await childItem.click();
  await expect(page).toHaveURL(new RegExp(`folder=${child.id}`));
  await expect(childItem).toHaveAttribute("aria-current", "page");

  await tree.getByRole("button", { name: "Thu gọn Dự án Alpha" }).click();
  await expect(childItem).toBeHidden();
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${child.id}`);
  await expect(tree.getByRole("treeitem", { name: "Thiết kế" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("FD-A03 open folder content view lists folders first, supports sorting, scopes creation, and handles invalid folder ID", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a03");
  const rootFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Kế toán",
  );
  await createPage(page, ws.owner.token, ws.wsId, "Trang ngoài gốc");
  const emptyFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Báo cáo",
    rootFolder.id,
  );
  await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Chứng từ",
    rootFolder.id,
  );
  await createPage(page, ws.owner.token, ws.wsId, "An toàn kho", rootFolder.id);
  await uploadFixtureFile(page, ws.owner.token, ws.wsId, "fx-docx-report-vi", {
    parentId: rootFolder.id,
    title: "Biên bản kiểm kê",
  });

  await loginFolderUser(page, ws.owner.email);
  await page.goto(
    `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${rootFolder.id}`,
  );

  const table = page.getByRole("table", { name: "Tài liệu" });
  await expect(table).toBeVisible();
  await expect(
    table.getByRole("button", { name: /^Trang ngoài gốc/ }),
  ).toHaveCount(0);

  const rowTexts = async (): Promise<string[]> =>
    table.locator("tbody tr td:first-child").allInnerTexts();
  const initialRows = await rowTexts();
  expect(initialRows.length).toBe(4);
  expect(initialRows[0]).toContain("Báo cáo");
  expect(initialRows[1]).toContain("Chứng từ");

  const sortSelect = page.getByLabel("Sắp xếp");
  await sortSelect.selectOption("updated");
  await page.reload();
  await expect(page.getByLabel("Sắp xếp")).toHaveValue("updated");
  const updatedRows = await rowTexts();
  const folderIndices = updatedRows
    .map((t, i) => (t.includes("Báo cáo") || t.includes("Chứng từ") ? i : -1))
    .filter((i) => i >= 0);
  expect(folderIndices).toEqual([0, 1]);

  await page.getByRole("button", { name: "Tạo mới", exact: true }).click();
  await page.getByRole("menuitem", { name: "Thư mục" }).click();
  const dlg = page.getByRole("dialog", {
    name: "Thư mục con mới trong Kế toán",
  });
  await dlg.getByLabel("Tên thư mục").fill("Sổ cái");
  await dlg.getByRole("button", { name: "Tạo" }).click();
  const afterCreate = await listDocuments(page, ws.owner.token, ws.wsId, {
    parent_id: rootFolder.id,
  });
  expect(afterCreate.documents.some((d) => d.title === "Sổ cái")).toBe(true);

  await page.goto(
    `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${emptyFolder.id}`,
  );
  await expect(page.getByText("Thư mục này chưa có gì")).toBeVisible();

  await page.goto(
    `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=01INVALIDFOLDER000000000000`,
  );
  await expect(
    page.getByRole("alert").getByText("Không mở được thư mục này"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Về Documents (gốc)" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${ws.orgSlug}/${ws.wsSlug}/documents$`),
  );
});

test("FD-A04 rename folder from tree menu, table row menu, and breadcrumb header updates UI and rejects duplicates", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a04");
  const folderA = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục A",
  );
  await createFolder(page, ws.owner.token, ws.wsId, "Thư mục B");
  const child = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Nhánh 1",
    folderA.id,
  );
  const doc = await uploadFixtureFile(
    page,
    ws.owner.token,
    ws.wsId,
    "fx-docx-report-vi",
    { parentId: child.id, title: "Tài liệu con" },
  );

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);

  const tree = page.getByRole("tree", { name: "Cây tài liệu" });
  await tree.getByRole("button", { name: "Thao tác cho Thư mục A" }).click();
  await page.getByRole("menuitem", { name: "Đổi tên" }).click();
  const renameDialog = page.getByRole("dialog", { name: "Đổi tên thư mục" });
  const input = renameDialog.getByLabel("Tên thư mục");
  await input.fill("Thư mục A1");
  await renameDialog.getByRole("button", { name: "Lưu" }).click();
  await expect(renameDialog).toBeHidden();
  await expect(
    tree.getByRole("treeitem", { name: "Thư mục A1" }),
  ).toBeVisible();

  const table = page.getByRole("table", { name: "Tài liệu" });
  await table.getByRole("button", { name: "Thao tác cho Thư mục B" }).click();
  await page.getByRole("menuitem", { name: "Đổi tên" }).click();
  await input.fill("  thư mục a1 ");
  await renameDialog.getByRole("button", { name: "Lưu" }).click();
  await expect(renameDialog.getByRole("alert")).toContainText(
    "Đã có thư mục tên này ở đây. Hãy đặt tên khác.",
  );
  await input.fill("   ");
  await renameDialog.getByRole("button", { name: "Lưu" }).click();
  await expect(renameDialog.getByRole("alert")).toContainText(
    "Nhập tên thư mục.",
  );
  await input.fill("Thư mục B1");
  await renameDialog.getByRole("button", { name: "Lưu" }).click();
  await expect(renameDialog).toBeHidden();
  await expect(
    tree.getByRole("treeitem", { name: "Thư mục B1" }),
  ).toBeVisible();

  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${child.id}`);
  const breadcrumb = page.getByRole("navigation", {
    name: "Đường dẫn thư mục",
  });
  await breadcrumb.getByRole("button", { name: "Đổi tên thư mục" }).click();
  await input.fill("Nhánh 1 Mới");
  await renameDialog.getByRole("button", { name: "Lưu" }).click();
  await expect(breadcrumb.getByText("Nhánh 1 Mới")).toBeVisible();

  const detail = await getDocument(page, ws.owner.token, doc.id);
  expect(detail.data?.breadcrumbs?.map((b) => b.title)).toEqual([
    "Thư mục A1",
    "Nhánh 1 Mới",
  ]);
});

test("FD-A05 move document or folder between folders and to root updates parent, tree, and breadcrumbs", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a05");
  const srcFolder = await createFolder(page, ws.owner.token, ws.wsId, "Nguồn");
  const dstFolder = await createFolder(page, ws.owner.token, ws.wsId, "Đích");
  const subFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Con Nguồn",
    srcFolder.id,
  );
  const fileDoc = await uploadFixtureFile(
    page,
    ws.owner.token,
    ws.wsId,
    "fx-docx-report-vi",
    { parentId: subFolder.id, title: "Hồ sơ chuyển" },
  );

  await loginFolderUser(page, ws.owner.email);
  await page.goto(
    `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${subFolder.id}`,
  );
  const table = page.getByRole("table", { name: "Tài liệu" });
  await table
    .getByRole("button", { name: "Thao tác cho Hồ sơ chuyển" })
    .click();
  await page.getByRole("menuitem", { name: /^Di chuyển/ }).click();

  const moveDialog = page.getByRole("dialog", { name: /^Di chuyển/ });
  await expect(moveDialog).toBeVisible();
  await moveDialog.getByRole("radio", { name: "Đích" }).click();
  await moveDialog.getByRole("button", { name: "Di chuyển" }).click();
  await expect(moveDialog).toBeHidden();

  const movedDoc = await getDocument(page, ws.owner.token, fileDoc.id);
  expect(movedDoc.data?.parent_id).toBe(dstFolder.id);
  expect(movedDoc.data?.breadcrumbs?.map((b) => b.title)).toEqual(["Đích"]);

  const movedSub = await moveDocument(page, ws.owner.token, subFolder.id, {
    parent_id: null,
    revision: subFolder.revision,
  });
  expect(movedSub.ok).toBe(true);
  expect(movedSub.data?.parent_id).toBeNull();
});

test("FD-A05 (FD-09 UI) tree-shaped Move-to picker disables current location with reason and shows move toast", async ({
  page,
}) => {
  test.skip(!process.env.E2E_FD09, "skip: needs FD-09 (UNI-1469)");
  skipWithoutFd09();
  const ws = await seedFolderWorkspace(page, "fd-a05-fd09");
  const src = await createFolder(page, ws.owner.token, ws.wsId, "Thư mục Gốc");
  await createFolder(page, ws.owner.token, ws.wsId, "Thư mục Đích");
  await createPage(page, ws.owner.token, ws.wsId, "Trang Chuyển", src.id);

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${src.id}`);
  await page
    .getByRole("table", { name: "Tài liệu" })
    .getByRole("button", { name: "Thao tác cho Trang Chuyển" })
    .click();
  await page.getByRole("menuitem", { name: /^Di chuyển/ }).click();
  const picker = page.getByRole("dialog", { name: "Di chuyển tới" });
  await expect(picker.getByText("Vị trí hiện tại")).toBeVisible();
  await picker.getByRole("treeitem", { name: /Thư mục Đích/ }).click();
  await picker.getByRole("button", { name: "Di chuyển" }).click();
  await expect(page.getByText("Đã chuyển tới Thư mục Đích")).toBeVisible();
});

test("FD-A06 moving folder into itself or a descendant is rejected with 422 document_cycle and leaves tree unchanged", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a06");
  const folderA = await createFolder(page, ws.owner.token, ws.wsId, "Cấp A");
  const folderB = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Cấp B",
    folderA.id,
  );
  const folderC = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Cấp C",
    folderB.id,
  );
  await uploadFixtureFile(page, ws.owner.token, ws.wsId, "fx-docx-report-vi", {
    parentId: folderC.id,
  });

  for (const targetId of [folderA.id, folderB.id, folderC.id]) {
    const res = await moveDocument(page, ws.owner.token, folderA.id, {
      parent_id: targetId,
      revision: folderA.revision,
    });
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe("document_cycle");
  }

  const tree = await getDocumentTree(page, ws.owner.token, ws.wsId, {
    folders_only: true,
  });
  expect(tree.length).toBe(1);
  expect(tree[0]?.id).toBe(folderA.id);
  expect(tree[0]?.children[0]?.id).toBe(folderB.id);
  expect(tree[0]?.children[0]?.children[0]?.id).toBe(folderC.id);
});

test("FD-A06 (FD-09 UI) Move-to picker disables self and descendants with reason Nằm trong chính nó", async ({
  page,
}) => {
  test.skip(!process.env.E2E_FD09, "skip: needs FD-09 (UNI-1469)");
  skipWithoutFd09();
  const ws = await seedFolderWorkspace(page, "fd-a06-fd09");
  const folderA = await createFolder(page, ws.owner.token, ws.wsId, "Nhánh A");
  await createFolder(page, ws.owner.token, ws.wsId, "Nhánh B", folderA.id);
  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);
  await page
    .getByRole("tree", { name: "Cây tài liệu" })
    .getByRole("button", { name: "Thao tác cho Nhánh A" })
    .click();
  await page.getByRole("menuitem", { name: "Di chuyển tới…" }).click();
  const picker = page.getByRole("dialog", { name: "Di chuyển tới" });
  await expect(picker.getByText("Nằm trong chính nó").first()).toBeVisible();
});

test("FD-A07 moving item into folder with colliding name auto-renames to Name (2) / Name (2).ext while create/rename still 409", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a07");
  const folderA = await createFolder(page, ws.owner.token, ws.wsId, "Phòng A");
  const folderB = await createFolder(page, ws.owner.token, ws.wsId, "Phòng B");

  await createFolder(page, ws.owner.token, ws.wsId, "Báo cáo", folderA.id);
  const dupFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Báo cáo",
    folderB.id,
  );
  const movedFolder = await moveDocument(page, ws.owner.token, dupFolder.id, {
    parent_id: folderA.id,
    revision: dupFolder.revision,
  });
  expect(movedFolder.ok).toBe(true);
  expect(movedFolder.data?.title).toBe("Báo cáo (2)");

  const dupCreate = await apiCreateDocument(page, ws.owner.token, ws.wsId, {
    title: "Báo cáo",
    kind: "folder",
    parent_id: folderA.id,
  });
  expect(dupCreate.status).toBe(409);
  expect(dupCreate.error?.code).toBe("folder_name_taken");

  const dupRename = await patchDocument(
    page,
    ws.owner.token,
    movedFolder.data!.id,
    { revision: movedFolder.data!.revision, title: "Báo cáo" },
  );
  expect(dupRename.status).toBe(409);
  expect(dupRename.error?.code).toBe("folder_name_taken");

  await uploadFixtureFile(page, ws.owner.token, ws.wsId, "fx-docx-report-vi", {
    parentId: folderA.id,
    title: "report.docx",
  });
  const docxB = await uploadFixtureFile(
    page,
    ws.owner.token,
    ws.wsId,
    "fx-docx-report-vi",
    { parentId: folderB.id, title: "report.docx" },
  );
  const movedDocx = await moveDocument(page, ws.owner.token, docxB.id, {
    parent_id: folderA.id,
    revision: docxB.revision,
  });
  expect(movedDocx.ok).toBe(true);
  expect(movedDocx.data?.title).toBe("report (2).docx");

  await uploadFixtureFile(page, ws.owner.token, ws.wsId, "fx-md-notes-vi", {
    parentId: folderA.id,
    title: "notes.md",
  });
  const mdB = await uploadFixtureFile(
    page,
    ws.owner.token,
    ws.wsId,
    "fx-md-notes-vi",
    { parentId: folderB.id, title: "notes.md" },
  );
  const movedMd = await moveDocument(page, ws.owner.token, mdB.id, {
    parent_id: folderA.id,
    revision: mdB.revision,
  });
  expect(movedMd.ok).toBe(true);
  expect(movedMd.data?.title).toBe("notes (2).md");

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${folderA.id}`);
  const table = page.getByRole("table", { name: "Tài liệu" });
  for (const name of [
    "Báo cáo",
    "Báo cáo (2)",
    "report.docx",
    "report (2).docx",
    "notes.md",
    "notes (2).md",
  ]) {
    await expect(
      table.getByRole("button", {
        name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      }),
    ).toBeVisible();
  }
});

test("FD-A07 (FD-09 UI) moving colliding item via Move-to picker shows toast Đã chuyển và đổi tên thành", async ({
  page,
}) => {
  test.skip(!process.env.E2E_FD09, "skip: needs FD-09 (UNI-1469)");
  skipWithoutFd09();
  const ws = await seedFolderWorkspace(page, "fd-a07-fd09");
  const folderA = await createFolder(page, ws.owner.token, ws.wsId, "Phòng A");
  const folderB = await createFolder(page, ws.owner.token, ws.wsId, "Phòng B");
  await createPage(page, ws.owner.token, ws.wsId, "Bản thảo", folderA.id);
  await createPage(page, ws.owner.token, ws.wsId, "Bản thảo", folderB.id);

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${folderB.id}`);
  await page
    .getByRole("table", { name: "Tài liệu" })
    .getByRole("button", { name: "Thao tác cho Bản thảo" })
    .click();
  await page.getByRole("menuitem", { name: /^Di chuyển/ }).click();
  const picker = page.getByRole("dialog", { name: "Di chuyển tới" });
  await picker.getByRole("treeitem", { name: /Phòng A/ }).click();
  await picker.getByRole("button", { name: "Di chuyển" }).click();
  await expect(
    page.getByText("Đã chuyển và đổi tên thành Bản thảo (2)"),
  ).toBeVisible();
});

test("FD-A08 folder depth cap of 20 allows level 20 and rejects level 21 on create and move with 422 document_too_deep", async ({
  page,
}) => {
  test.slow();
  const ws = await seedFolderWorkspace(page, "fd-a08");
  const chain = await createFolderChain(
    page,
    ws.owner.token,
    ws.wsId,
    20,
    "Cấp",
  );
  const level19 = chain[18]!;
  const level20 = chain[19]!;

  const tooDeepCreate = await apiCreateDocument(
    page,
    ws.owner.token,
    ws.wsId,
    {
      title: "Cấp 21",
      kind: "folder",
      parent_id: level20.id,
    },
  );
  expect(tooDeepCreate.status).toBe(422);
  expect(tooDeepCreate.error?.code).toBe("document_too_deep");

  const fileAt20 = await uploadFixtureFile(
    page,
    ws.owner.token,
    ws.wsId,
    "fx-docx-report-vi",
    { parentId: level19.id, title: "Tệp ở cấp 20" },
  );
  const movePast20 = await moveDocument(page, ws.owner.token, fileAt20.id, {
    parent_id: level20.id,
    revision: fileAt20.revision,
  });
  expect(movePast20.status).toBe(422);
  expect(movePast20.error?.code).toBe("document_too_deep");

  const branchRoot = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Nhánh 2 cấp",
  );
  await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Nhánh con",
    branchRoot.id,
  );
  const moveSubtreePast20 = await moveDocument(
    page,
    ws.owner.token,
    branchRoot.id,
    { parent_id: level19.id, revision: branchRoot.revision },
  );
  expect(moveSubtreePast20.status).toBe(422);
  expect(moveSubtreePast20.error?.code).toBe("document_too_deep");

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${level20.id}`);
  const breadcrumb = page.getByRole("navigation", {
    name: "Đường dẫn thư mục",
  });
  await expect(breadcrumb).toBeVisible();
  await expect(breadcrumb.getByText(level20.title)).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("FD-A08 (FD-09 UI) deep breadcrumb collapses middle levels into menu and Move-to picker disables >20 depth targets", async ({
  page,
}) => {
  test.skip(!process.env.E2E_FD09, "skip: needs FD-09 (UNI-1469)");
  skipWithoutFd09();
  const ws = await seedFolderWorkspace(page, "fd-a08-fd09");
  const chain = await createFolderChain(
    page,
    ws.owner.token,
    ws.wsId,
    6,
    "Sâu",
  );
  await loginFolderUser(page, ws.owner.email);
  await page.goto(
    `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${chain[5]!.id}`,
  );
  const breadcrumb = page.getByRole("navigation", {
    name: "Đường dẫn thư mục",
  });
  await breadcrumb.getByRole("button", { name: "Các cấp ẩn" }).click();
  await page.getByRole("menuitem", { name: chain[2]!.title }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${chain[2]!.id}`));
});

test("FD-A09 unified search and ⌘K find folders and documents by title, filter by kind, show paths, and exclude body-only matches", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a09");
  const finFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Tài chính 2026",
  );
  const q1Folder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Quý 1",
    finFolder.id,
  );
  const partnerFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Hợp đồng Đối tác",
    finFolder.id,
  );
  await uploadFixtureFile(page, ws.owner.token, ws.wsId, "fx-docx-report-vi", {
    parentId: q1Folder.id,
    title: "Báo cáo Hợp đồng Quý 1",
  });
  await uploadFixtureFile(
    page,
    ws.owner.token,
    ws.wsId,
    "fx-xlsx-revenue-xyz",
    { parentId: q1Folder.id, title: "Bảng tính Hợp đồng Quý 1" },
  );
  await createPage(page, ws.owner.token, ws.wsId, "Trang ghi chú nội bộ", null, {
    bodyText: "Chuỗi bí mật chỉ nằm trong thân bài BODYONLYTOKEN99",
  });

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);

  const searchInput = page.getByRole("searchbox", {
    name: "Tìm trong Documents",
  });
  await searchInput.fill("hop dong");

  const resultsList = page.getByRole("list", { name: "Tìm trong Documents" });
  await expect(resultsList.getByText("Hợp đồng Đối tác")).toBeVisible();
  await expect(resultsList.getByText("Báo cáo Hợp đồng Quý 1")).toBeVisible();
  await expect(resultsList.getByText("Bảng tính Hợp đồng Quý 1")).toBeVisible();
  await expect(
    resultsList.getByText("Đường dẫn: Tài chính 2026 / Quý 1").first(),
  ).toBeVisible();

  const filterGroup = page.getByRole("radiogroup", { name: "Lọc kết quả" });
  await filterGroup.getByRole("radio", { name: "Thư mục" }).click();
  await expect(resultsList.getByText("Hợp đồng Đối tác")).toBeVisible();
  await expect(
    resultsList.getByText("Báo cáo Hợp đồng Quý 1"),
  ).toHaveCount(0);

  await filterGroup.getByRole("radio", { name: "Tài liệu" }).click();
  await expect(resultsList.getByText("Báo cáo Hợp đồng Quý 1")).toBeVisible();
  await expect(resultsList.getByText("Hợp đồng Đối tác")).toHaveCount(0);

  await filterGroup.getByRole("radio", { name: "Tất cả" }).click();
  await searchInput.fill("BODYONLYTOKEN99");
  await expect(page.getByText("Không tìm thấy kết quả")).toBeVisible();
  await expect(resultsList).toHaveCount(0);

  await searchInput.fill("Hợp đồng Đối tác");
  await resultsList.getByRole("button", { name: /Hợp đồng Đối tác/ }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${partnerFolder.id}`));

  await page.keyboard.press("Control+k");
  const cmdDialog = page.getByRole("dialog");
  const cmdInput = cmdDialog.getByPlaceholder(
    "Tìm công việc, tài liệu, cuộc họp, thành viên...",
  );
  await expect(cmdInput).toBeVisible();
  await cmdInput.fill("Quý 1");
  await cmdDialog.getByRole("option", { name: /Quý 1/ }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${q1Folder.id}`));
});

test("FD-A10 moving a document between folders preserves ID, versions, comments, shares, and links", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a10", { withMemberB: true });
  const folderA = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Nguồn",
  );
  const folderB = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Đích",
  );
  const doc = await uploadFixtureFile(
    page,
    ws.owner.token,
    ws.wsId,
    "fx-docx-report-vi",
    { parentId: folderA.id, title: "Báo cáo Giữ nguyên ID" },
  );
  await seedDocumentArtifacts(
    page,
    ws.owner.token,
    doc.id,
    ws.member!.id,
  );
  const before = await readDocumentArtifacts(page, ws.owner.token, doc.id);
  expect(before.versionNumbers.length).toBeGreaterThanOrEqual(2);
  expect(before.commentIds.length).toBe(1);
  expect(before.shareIds.length).toBe(1);

  const docUrl = `/${ws.orgSlug}/${ws.wsSlug}/documents/${doc.id}`;
  const authJson = {
    authorization: `Bearer ${ws.owner.token}`,
    "content-type": "application/json",
  };
  const taskRes = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/tasks`,
    {
      headers: authJson,
      data: { title: "Task gắn tài liệu", description: `Xem ${docUrl}` },
    },
  );
  expect(taskRes.ok()).toBeTruthy();

  const meetingRes = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/meetings`,
    {
      headers: authJson,
      data: { title: `Họp duyệt ${docUrl}`, type: "instant" },
    },
  );
  expect(meetingRes.ok()).toBeTruthy();

  const chatRes = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/messages`,
    {
      headers: authJson,
      data: { content: `Tài liệu đính kèm: ${docUrl}` },
    },
  );
  expect(chatRes.ok()).toBeTruthy();

  const moved = await moveDocument(page, ws.owner.token, doc.id, {
    parent_id: folderB.id,
    revision: doc.revision,
  });
  expect(moved.ok).toBe(true);
  expect(moved.data?.id).toBe(doc.id);
  expect(moved.data?.parent_id).toBe(folderB.id);

  const after = await readDocumentArtifacts(page, ws.owner.token, doc.id);
  expect(after).toEqual(before);

  const listOld = await listDocuments(page, ws.owner.token, ws.wsId, {
    parent_id: folderA.id,
  });
  const listNew = await listDocuments(page, ws.owner.token, ws.wsId, {
    parent_id: folderB.id,
  });
  expect(listOld.documents.map((d) => d.id)).not.toContain(doc.id);
  expect(listNew.documents.map((d) => d.id)).toEqual([doc.id]);

  await loginFolderUser(page, ws.owner.email);
  await page.goto(docUrl);
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}$`));
});

test("FD-A10 (entity/email link API) structured graph DOCUMENT links and email-hub thread links resolve after move", async () => {
  const reason =
    "skip: structured entity-to-document links (Work Graph DOCUMENT slice 2, chat_links target_type=document) and Email Hub IMAP seeding have no REST seed API yet";
  if (!process.env.E2E_DOC_ENTITY_LINKS) {
    console.log(reason);
    test.skip(true, reason);
  }
});

test("FD-A11 view-only user on folder sees allowed content, cannot write, and never sees restricted children", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a11", { withMemberB: true });
  const folder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Hồ sơ Nội bộ",
    null,
    "restricted",
  );
  await grantDocumentShare(
    page,
    ws.owner.token,
    folder.id,
    ws.member!.id,
    "view",
  );

  await uploadFixtureFile(page, ws.owner.token, ws.wsId, "fx-docx-report-vi", {
    parentId: folder.id,
    title: "Báo cáo Công khai",
  });
  const secretDoc = await createPage(
    page,
    ws.owner.token,
    ws.wsId,
    "Mật khẩu Tuyệt mật",
    folder.id,
    { visibility: "restricted" },
  );
  await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Bí mật",
    folder.id,
    "restricted",
  );

  await loginFolderUser(page, ws.member!.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${folder.id}`);

  const table = page.getByRole("table", { name: "Tài liệu" });
  await expect(
    table.getByRole("button", { name: /^Báo cáo Công khai/ }),
  ).toBeVisible();
  await expect(
    table.getByRole("button", { name: /^Mật khẩu Tuyệt mật/ }),
  ).toHaveCount(0);
  await expect(
    table.getByRole("button", { name: /^Thư mục Bí mật/ }),
  ).toHaveCount(0);

  await expect(
    page.getByText(
      "Bạn chỉ có quyền xem thư mục Hồ sơ Nội bộ: mở file để đọc, không tạo hay sửa được.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tạo mới", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Đường dẫn thư mục" })
      .getByRole("button", { name: "Đổi tên thư mục" }),
  ).toHaveCount(0);

  const searchInput = page.getByRole("searchbox", {
    name: "Tìm trong Documents",
  });
  await searchInput.fill("Mật khẩu Tuyệt mật");
  await expect(page.getByText("Không tìm thấy kết quả")).toBeVisible();

  const createAsB = await apiCreateDocument(page, ws.member!.token, ws.wsId, {
    title: "Thử Tạo",
    kind: "folder",
    parent_id: folder.id,
  });
  expect(createAsB.status).toBe(403);
  const renameAsB = await patchDocument(page, ws.member!.token, folder.id, {
    revision: folder.revision,
    title: "Đổi Tên Trái Phép",
  });
  expect(renameAsB.status).toBe(403);
  const moveAsB = await moveDocument(page, ws.member!.token, folder.id, {
    parent_id: null,
    revision: folder.revision,
  });
  expect(moveAsB.status).toBe(403);
  const archiveAsB = await archiveDocument(page, ws.member!.token, folder.id);
  expect(archiveAsB.status).toBe(403);
  const secretGet = await getDocument(page, ws.member!.token, secretDoc.id);
  expect(secretGet.status).toBe(404);
});

test("FD-A12 archiving and restoring folder subtree moves all items in one batch, blocks on unmanageable child (403) and >1000 nodes (422 folder_too_large)", async ({
  page,
}) => {
  test.slow();
  const ws = await seedFolderWorkspace(page, "fd-a12", { withMemberB: true });
  const rootFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Dự án Đóng",
  );
  const sub1 = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Giai đoạn 1",
    rootFolder.id,
  );
  const sub2 = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Giai đoạn 2",
    rootFolder.id,
  );
  const doc1 = await uploadFixtureFile(
    page,
    ws.owner.token,
    ws.wsId,
    "fx-docx-report-vi",
    { parentId: sub1.id, title: "Báo cáo Kết thúc" },
  );
  const doc2 = await createPage(
    page,
    ws.owner.token,
    ws.wsId,
    "Biên bản 1",
    sub1.id,
  );
  const doc3 = await createPage(
    page,
    ws.owner.token,
    ws.wsId,
    "Biên bản 2",
    sub2.id,
  );

  const impact = await getArchiveImpact(page, ws.owner.token, rootFolder.id);
  expect(impact.ok).toBe(true);
  expect(impact.data).toMatchObject({
    folders: 2,
    documents: 3,
    total: 6,
    too_large: false,
  });

  const archived = await archiveDocument(page, ws.owner.token, rootFolder.id);
  expect(archived.ok).toBe(true);
  expect(archived.data?.affected.sort()).toEqual(
    [rootFolder.id, sub1.id, sub2.id, doc1.id, doc2.id, doc3.id].sort(),
  );

  const searchLive = await listDocuments(page, ws.owner.token, ws.wsId, {
    q: "Báo cáo Kết thúc",
    match: "title",
  });
  expect(searchLive.documents).toHaveLength(0);
  const treeLive = await getDocumentTree(page, ws.owner.token, ws.wsId, {
    folders_only: true,
  });
  expect(treeLive.some((n) => n.id === rootFolder.id)).toBe(false);

  const restored = await restoreDocument(page, ws.owner.token, rootFolder.id);
  expect(restored.ok).toBe(true);
  const doc1After = await getDocument(page, ws.owner.token, doc1.id);
  expect(doc1After.data?.parent_id).toBe(sub1.id);
  expect(doc1After.data?.archived_at).toBeNull();

  await archiveDocument(page, ws.owner.token, rootFolder.id);
  const singleRestore = await restoreDocument(page, ws.owner.token, doc1.id);
  expect(singleRestore.ok).toBe(true);
  const doc1AtRoot = await getDocument(page, ws.owner.token, doc1.id);
  expect(doc1AtRoot.data?.parent_id).toBeNull();

  const folderB = await createFolder(
    page,
    ws.member!.token,
    ws.wsId,
    "Thư mục Của B",
  );
  const childOfA = await createPage(
    page,
    ws.owner.token,
    ws.wsId,
    "Trang Của A",
    folderB.id,
  );
  const impactB = await getArchiveImpact(page, ws.member!.token, folderB.id);
  expect(impactB.status).toBe(403);
  const archiveB = await archiveDocument(page, ws.member!.token, folderB.id);
  expect(archiveB.status).toBe(403);
  expect((await getDocument(page, ws.owner.token, childOfA.id)).data?.archived_at).toBeNull();

  const hugeFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Khổng lồ",
  );
  await seedFolderSubtreeBatch(
    page,
    ws.owner.token,
    ws.wsId,
    hugeFolder.id,
    1000,
    "Mục",
    25,
  );
  const hugeImpact = await getArchiveImpact(
    page,
    ws.owner.token,
    hugeFolder.id,
  );
  expect(hugeImpact.ok).toBe(true);
  expect(hugeImpact.data?.too_large).toBe(true);
  const hugeArchive = await archiveDocument(
    page,
    ws.owner.token,
    hugeFolder.id,
  );
  expect(hugeArchive.status).toBe(422);
  expect(hugeArchive.error?.code).toBe("folder_too_large");
});

test("FD-A12 (FD-09 UI) delete folder dialog shows server subfolder/document counts, blocks >1000 items and 403, and shows trash/restore toasts", async ({
  page,
}) => {
  test.skip(!process.env.E2E_FD09, "skip: needs FD-09 (UNI-1469)");
  skipWithoutFd09();
  const ws = await seedFolderWorkspace(page, "fd-a12-fd09");
  const root = await createFolder(page, ws.owner.token, ws.wsId, "Xóa Thử");
  await createFolder(page, ws.owner.token, ws.wsId, "Con 1", root.id);
  await createPage(page, ws.owner.token, ws.wsId, "Trang 1", root.id);

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);
  await page
    .getByRole("tree", { name: "Cây tài liệu" })
    .getByRole("button", { name: "Thao tác cho Xóa Thử" })
    .click();
  await page.getByRole("menuitem", { name: "Xóa" }).click();
  const dlg = page.getByRole("dialog", { name: "Xóa thư mục" });
  await expect(
    dlg.getByText(
      "1 thư mục con và 1 tài liệu sẽ được chuyển vào thùng rác và có thể khôi phục trong 30 ngày.",
    ),
  ).toBeVisible();
  await dlg.getByRole("button", { name: "Xóa" }).click();
  await expect(page.getByText("Đã chuyển Xóa Thử vào thùng rác")).toBeVisible();
});
