import { expect, test } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import {
  apiCreateDocument,
  archiveDocument,
  contentRow,
  contentRowOpen,
  createFolder,
  createFolderChain,
  createPage,
  getArchiveImpact,
  getDocument,
  getDocumentTree,
  getFixtureFilePath,
  grantDocumentShare,
  listDocuments,
  listDocumentSources,
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

test("FD-A01 create folder from sidebar +, Mới menu, and tree row menu down to depth 20; rejects blank, >255 chars, and depth 21", async ({
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

  let folderPostCalls = 0;
  const countCreatePost = (req: { method: () => string; url: () => string }) => {
    if (
      req.method() === "POST" &&
      req.url().endsWith(`/api/v1/workspaces/${ws.wsId}/documents`)
    ) {
      folderPostCalls += 1;
    }
  };
  page.on("request", countCreatePost);

  await input.fill("   ");
  await dialog.getByRole("button", { name: "Tạo" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Nhập tên thư mục.");
  expect(folderPostCalls).toBe(0);

  const over255 = "K".repeat(256);
  await input.fill(over255);
  await dialog.getByRole("button", { name: "Tạo" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Tên thư mục tối đa 255 ký tự.",
  );
  expect(folderPostCalls).toBe(0);
  page.off("request", countCreatePost);

  const apiMax255 = await apiCreateDocument(page, ws.owner.token, ws.wsId, {
    title: "M".repeat(255),
    kind: "folder",
  });
  expect(
    apiMax255.status,
    `${apiMax255.status} ${JSON.stringify(apiMax255.error)}`,
  ).toBe(201);
  expect(apiMax255.data?.title.length).toBe(255);

  const apiTooLong = await apiCreateDocument(page, ws.owner.token, ws.wsId, {
    title: over255,
    kind: "folder",
  });
  expect(
    apiTooLong.status,
    `${apiTooLong.status} ${JSON.stringify(apiTooLong.error)}`,
  ).toBe(400);

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
  // server/internal/handler/document_collections.go:315-317 omits parent_id when doc.ParentID is null at root.
  expect(rootFolder?.parent_id).toBeUndefined();

  await tree.getByRole("treeitem", { name: "Hợp đồng 2026" }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${rootFolder!.id}`));

  // Clicking sidebar "+" while inside an open folder creates at the workspace root (parent_id omitted).
  await sidebar.getByRole("button", { name: "Tạo thư mục" }).click();
  await expect(dialog).toBeVisible();
  await input.fill("Thư mục Gốc Khi Đang Mở Con");
  await dialog.getByRole("button", { name: "Tạo" }).click();
  await expect(dialog).toBeHidden();
  const rootListAfterPlus = await listDocuments(page, ws.owner.token, ws.wsId, {
    parent_id: "",
  });
  const createdFromPlus = rootListAfterPlus.documents.find(
    (d) => d.title === "Thư mục Gốc Khi Đang Mở Con",
  );
  // server/internal/handler/document_collections.go:315-317 omits parent_id for root items.
  expect(createdFromPlus?.parent_id).toBeUndefined();

  await page.goto(
    `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${rootFolder!.id}`,
  );
  await page.getByRole("button", { name: "Tạo mới", exact: true }).click();
  await page.getByRole("menuitem", { name: "Thư mục" }).click();
  const subDialog = page.getByRole("dialog", {
    name: "Thư mục con mới trong Hợp đồng 2026",
  });
  await subDialog.getByLabel("Tên thư mục").fill("Phụ lục Q1");
  await subDialog.getByRole("button", { name: "Tạo" }).click();
  await expect(subDialog).toBeHidden();
  await expect(contentRow(page, "Phụ lục Q1")).toBeVisible();
  await expect(
    contentRow(page, "Phụ lục Q1").getByRole("img", { name: "Thư mục" }),
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

  // Depth 20 is allowed; depth 21 is rejected with 422 document_too_deep.
  const chain = await createFolderChain(
    page,
    ws.owner.token,
    ws.wsId,
    20,
    "Cấp",
  );
  const level20 = chain[19]!;
  expect(level20.parent_id).toBe(chain[18]!.id);
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
  expect(
    tooDeepCreate.status,
    `${tooDeepCreate.status} ${JSON.stringify(tooDeepCreate.error)}`,
  ).toBe(422);
  expect(tooDeepCreate.error?.code).toBe("document_too_deep");
});

test("FD-A02 sidebar folder tree expands/collapses independently, reveals active ?folder= ancestors, and stays collapsed across a refetch", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a02");
  const branchA = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Dự án Alpha",
  );
  const childA = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thiết kế Alpha",
    branchA.id,
  );
  const branchB = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Dự án Beta",
  );
  const childB = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Triển khai Beta",
    branchB.id,
  );
  await createPage(page, ws.owner.token, ws.wsId, "Trang Ghi chú", branchA.id);
  await uploadFixtureFile(page, ws.owner.token, ws.wsId, "fx-docx-report-vi", {
    parentId: branchA.id,
    title: "Báo cáo Đính kèm",
  });

  const treeNodes = await getDocumentTree(page, ws.owner.token, ws.wsId, {
    folders_only: true,
  });
  expect(treeNodes.every((n) => n.kind === "folder")).toBe(true);
  expect(treeNodes.every((n) => n.children.every((c) => c.kind === "folder"))).toBe(
    true,
  );

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);

  const tree = page.getByRole("tree", { name: "Cây tài liệu" });
  const itemA = tree.getByRole("treeitem", { name: "Dự án Alpha" });
  const itemB = tree.getByRole("treeitem", { name: "Dự án Beta" });
  await expect(itemA).toBeVisible();
  await expect(itemB).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Thiết kế Alpha" })).toBeHidden();
  await expect(tree.getByRole("treeitem", { name: "Triển khai Beta" })).toBeHidden();

  // Expanding branch A does not expand sibling branch B.
  await tree.getByRole("button", { name: "Mở rộng Dự án Alpha" }).click();
  await expect(
    tree.getByRole("treeitem", { name: "Thiết kế Alpha" }),
  ).toBeVisible();
  await expect(
    tree.getByRole("treeitem", { name: "Triển khai Beta" }),
  ).toBeHidden();
  await expect(
    tree.getByRole("treeitem", { name: "Trang Ghi chú" }),
  ).toHaveCount(0);
  await expect(
    tree.getByRole("treeitem", { name: "Báo cáo Đính kèm" }),
  ).toHaveCount(0);

  // Expanding branch B then collapsing branch A leaves branch B expanded.
  await tree.getByRole("button", { name: "Mở rộng Dự án Beta" }).click();
  await expect(
    tree.getByRole("treeitem", { name: "Triển khai Beta" }),
  ).toBeVisible();
  await tree.getByRole("button", { name: "Thu gọn Dự án Alpha" }).click();
  await expect(
    tree.getByRole("treeitem", { name: "Thiết kế Alpha" }),
  ).toBeHidden();
  await expect(
    tree.getByRole("treeitem", { name: "Triển khai Beta" }),
  ).toBeVisible();

  // Trigger a tree refetch via a server mutation (realtime invalidation) without page reload:
  // the collapsed branch A must stay collapsed while branch B stays expanded and the new root folder appears.
  await createFolder(page, ws.owner.token, ws.wsId, "Dự án Gamma");
  await expect(
    tree.getByRole("treeitem", { name: "Dự án Gamma" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    tree.getByRole("treeitem", { name: "Thiết kế Alpha" }),
  ).toBeHidden();
  await expect(
    tree.getByRole("treeitem", { name: "Triển khai Beta" }),
  ).toBeVisible();

  // Opening ?folder=childA.id expands every ancestor once and marks the active row.
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${childA.id}`);
  const childAItem = tree.getByRole("treeitem", { name: "Thiết kế Alpha" });
  await expect(childAItem).toBeVisible();
  // packages/views/documents/document-tree.tsx:118 sets aria-current={current || undefined} -> "true" on treeitem.
  await expect(childAItem).toHaveAttribute("aria-current", "true");

  // If the user collapses the ancestor while viewing childA, a subsequent tree refetch does not force it back open.
  await tree.getByRole("button", { name: "Thu gọn Dự án Alpha" }).click();
  await expect(childAItem).toBeHidden();
  await createFolder(page, ws.owner.token, ws.wsId, "Dự án Delta", childB.id);
  const patchedB = await patchDocument(page, ws.owner.token, branchB.id, {
    revision: branchB.revision,
    title: "Dự án Beta Mới",
  });
  expect(
    patchedB.ok,
    `patchDocument: ${patchedB.status} ${JSON.stringify(patchedB.error)}`,
  ).toBe(true);
  await expect(
    tree.getByRole("treeitem", { name: "Dự án Beta Mới" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(childAItem).toBeHidden();
});

test("FD-A03 open folder content view lists only direct children, folders first, sorted by name or updated per viewer", async ({
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
  const subFolder = await createFolder(
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
  await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Cháu",
    subFolder.id,
  );
  await createPage(
    page,
    ws.owner.token,
    ws.wsId,
    "Tài liệu Cháu",
    subFolder.id,
  );
  const directPage = await createPage(
    page,
    ws.owner.token,
    ws.wsId,
    "An toàn kho",
    rootFolder.id,
  );
  await createPage(
    page,
    ws.owner.token,
    ws.wsId,
    "Trang Con Của Trang",
    directPage.id,
  );
  await uploadFixtureFile(page, ws.owner.token, ws.wsId, "fx-docx-report-vi", {
    parentId: rootFolder.id,
    title: "Biên bản kiểm kê.docx",
  });

  await loginFolderUser(page, ws.owner.email);
  await page.goto(
    `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${rootFolder.id}`,
  );

  const table = page.getByRole("table", { name: "Tài liệu" });
  await expect(table).toBeVisible();
  await expect(contentRow(page, "Báo cáo")).toBeVisible();
  await expect(
    contentRow(page, "Báo cáo").getByRole("img", { name: "Thư mục" }),
  ).toBeVisible();
  await expect(contentRow(page, "Chứng từ")).toBeVisible();
  await expect(contentRow(page, "An toàn kho")).toBeVisible();
  await expect(
    contentRow(page, "An toàn kho").getByRole("img", {
      name: "Trang UniWork",
    }),
  ).toBeVisible();
  await expect(contentRow(page, "Biên bản kiểm kê.docx")).toBeVisible();
  await expect(
    contentRow(page, "Biên bản kiểm kê.docx").getByRole("img", {
      name: "Tài liệu Word",
    }),
  ).toBeVisible();
  await expect(contentRow(page, "Trang ngoài gốc")).toHaveCount(0);
  await expect(contentRow(page, "Thư mục Cháu")).toHaveCount(0);
  await expect(contentRow(page, "Tài liệu Cháu")).toHaveCount(0);
  await expect(contentRow(page, "Trang Con Của Trang")).toHaveCount(0);

  const rowTexts = async (): Promise<string[]> =>
    table.locator("tbody tr td:first-child").allInnerTexts();
  const initialRows = await rowTexts();
  // 4 direct children under rootFolder (2 folders: Báo cáo, Chứng từ; 2 docs: An toàn kho, Biên bản kiểm kê.docx);
  // packages/views/documents/library-rows.ts:96-119 sorts folders first, then by Vietnamese collator.
  expect(initialRows.length).toBe(4);
  expect(initialRows[0]).toContain("Báo cáo");
  expect(initialRows[1]).toContain("Chứng từ");

  const sortTrigger = page.getByLabel("Sắp xếp");
  await sortTrigger.click();
  await page.getByRole("option", { name: "Cập nhật (mới nhất)" }).click();
  await page.reload();
  await expect(page.getByLabel("Sắp xếp")).toContainText(
    "Cập nhật (mới nhất)",
  );
  const updatedRows = await rowTexts();
  const folderIndices = updatedRows
    .map((t, i) => (t.includes("Báo cáo") || t.includes("Chứng từ") ? i : -1))
    .filter((i) => i >= 0);
  expect(folderIndices).toEqual([0, 1]);

  // Documents home keeps the workspace library view.
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);
  await expect(contentRow(page, "Trang ngoài gốc")).toBeVisible();
  await expect(contentRowOpen(page, "Trang ngoài gốc")).toBeVisible();
});

test("FD-A03 upload into the open folder places the uploaded file under the open folder (not at root)", async ({
  page,
}) => {
  test.skip(!process.env.E2E_FD09, "skip: needs FD-09 (UNI-1469) incl. the fileForm field-order fix");
  const ws = await seedFolderWorkspace(page, "fd-a03-upload");
  const openFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Nhận Tải Lên",
  );

  await loginFolderUser(page, ws.owner.email);
  await page.goto(
    `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${openFolder.id}`,
  );
  // Wait for folder detail breadcrumb to render so parentForCreate === openFolder.id
  // (packages/views/documents/documents-page-view.tsx:156,185-194).
  await expect(
    page
      .getByRole("navigation", { name: "Đường dẫn thư mục" })
      .getByText("Thư mục Nhận Tải Lên"),
  ).toBeVisible();

  // Open the real Upload file dialog from the header/cards (packages/views/documents/documents-home-create.tsx:117,135).
  await page.getByRole("button", { name: /^Tải file lên/ }).first().click();
  const uploadDialog = page.getByRole("dialog", { name: "Tải tệp lên" });
  await expect(uploadDialog).toBeVisible();
  await uploadDialog
    .getByLabel("Chọn tệp")
    .setInputFiles(getFixtureFilePath("fx-docx-report-vi"));
  await uploadDialog.getByRole("button", { name: "Tải lên" }).click();
  await expect(uploadDialog).toBeHidden();
  await expect(page).toHaveURL(/\/documents\/[0-9A-Za-z]+$/);

  const uploadedDocId = page.url().split("/documents/")[1]!.split(/[?#]/)[0]!;
  expect(uploadedDocId).toBeTruthy();

  // Assert through the API that the uploaded document's parent_id equals openFolder.id
  // and that it is listed in openFolder's content (not at the workspace root).
  const uploadedDetail = await getDocument(page, ws.owner.token, uploadedDocId);
  expect(
    uploadedDetail.ok,
    `getDocument: ${uploadedDetail.status} ${JSON.stringify(uploadedDetail.error)}`,
  ).toBe(true);
  expect(uploadedDetail.data?.parent_id).toBe(openFolder.id);

  const folderChildren = await listDocuments(
    page,
    ws.owner.token,
    ws.wsId,
    { parent_id: openFolder.id },
  );
  expect(folderChildren.documents.map((d) => d.id)).toContain(uploadedDocId);

  const rootChildren = await listDocuments(page, ws.owner.token, ws.wsId, {
    parent_id: "",
  });
  expect(rootChildren.documents.map((d) => d.id)).not.toContain(uploadedDocId);
});

test("FD-A04 rename folder from tree menu, table row menu, and breadcrumb keeps ID/parent/children and updates title and search", async ({
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
    page.getByText("Đã đổi tên thành Thư mục A1"),
  ).toBeVisible();
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
  const inlineInput = breadcrumb.getByLabel("Tên thư mục");
  await inlineInput.fill("Nhánh 1 Mới");
  await inlineInput.press("Enter");
  await expect(breadcrumb.getByText("Nhánh 1 Mới")).toBeVisible();

  const folderAAfter = await getDocument(page, ws.owner.token, folderA.id);
  expect(
    folderAAfter.ok,
    `getDocument: ${folderAAfter.status} ${JSON.stringify(folderAAfter.error)}`,
  ).toBe(true);
  expect(folderAAfter.data?.id).toBe(folderA.id);
  // server/internal/handler/documents.go:834-836 omits parent_id when doc.ParentID is null at root.
  expect(folderAAfter.data?.parent_id).toBeUndefined();
  const childAfter = await getDocument(page, ws.owner.token, child.id);
  expect(
    childAfter.ok,
    `getDocument: ${childAfter.status} ${JSON.stringify(childAfter.error)}`,
  ).toBe(true);
  expect(childAfter.data?.id).toBe(child.id);
  expect(childAfter.data?.parent_id).toBe(folderA.id);
  const detail = await getDocument(page, ws.owner.token, doc.id);
  expect(
    detail.ok,
    `getDocument: ${detail.status} ${JSON.stringify(detail.error)}`,
  ).toBe(true);
  expect(detail.data?.id).toBe(doc.id);
  expect(detail.data?.parent_id).toBe(child.id);
  expect(detail.data?.breadcrumbs?.map((b) => b.title)).toEqual([
    "Thư mục A1",
    "Nhánh 1 Mới",
  ]);

  const searchRenamed = await listDocuments(page, ws.owner.token, ws.wsId, {
    q: "Nhanh 1 Moi",
    match: "title",
  });
  expect(searchRenamed.documents.map((d) => d.id)).toContain(child.id);
});

test("FD-A05 move folder by drag-and-drop and Move-to keeps descendants, enforces depth<=20, renames on collision, and updates a second session live", async ({
  page,
  browser,
}) => {
  test.slow();
  const ws = await seedFolderWorkspace(page, "fd-a05", { withMemberB: true });
  // Create dragFolder first and dstFolder second so dragFolder sits directly above dstFolder
  // in the sidebar tree (packages/views/documents/document-tree.tsx:257,489-495).
  const dragFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Kéo Thả",
  );
  const dstFolder = await createFolder(page, ws.owner.token, ws.wsId, "Đích");
  const srcFolder = await createFolder(page, ws.owner.token, ws.wsId, "Nguồn");
  const dragChild = await createPage(
    page,
    ws.owner.token,
    ws.wsId,
    "Trang Trong Kéo Thả",
    dragFolder.id,
  );
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
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${dstFolder.id}`);

  // 1. Drag-and-drop move in the sidebar tree (PointerSensor distance >= 5px, document-tree.tsx:257).
  const tree = page.getByRole("tree", { name: "Cây tài liệu" });
  const dragItem = tree.getByRole("treeitem", { name: "Thư mục Kéo Thả" });
  const dropTarget = tree.getByRole("treeitem", { name: "Đích" });
  await expect(dragItem).toBeVisible();
  await expect(dropTarget).toBeVisible();
  const srcBox = await dragItem.boundingBox();
  const dstBox = await dropTarget.boundingBox();
  expect(srcBox && dstBox).toBeTruthy();
  await page.mouse.move(
    srcBox!.x + srcBox!.width / 2,
    srcBox!.y + srcBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    srcBox!.x + srcBox!.width / 2 + 10,
    srcBox!.y + srcBox!.height / 2 + 10,
    { steps: 5 },
  );
  await page.mouse.move(
    dstBox!.x + dstBox!.width / 2,
    dstBox!.y + dstBox!.height / 2,
    { steps: 10 },
  );
  // packages/views/documents/document-tree.tsx:100,149 applies ring-2 when useDroppable.isOver is true.
  await expect(dropTarget).toHaveClass(/ring-2/);
  await page.mouse.up();

  await expect(
    tree.getByRole("treeitem", { name: "Thư mục Kéo Thả" }),
  ).toHaveAttribute("aria-level", "2", { timeout: 15_000 });
  const table = page.getByRole("table", { name: "Tài liệu" });
  await expect(contentRow(page, "Thư mục Kéo Thả")).toBeVisible({
    timeout: 15_000,
  });
  const dragAfter = await getDocument(page, ws.owner.token, dragFolder.id);
  expect(
    dragAfter.ok,
    `getDocument: ${dragAfter.status} ${JSON.stringify(dragAfter.error)}`,
  ).toBe(true);
  expect(dragAfter.data?.parent_id).toBe(dstFolder.id);
  const dragChildAfter = await getDocument(page, ws.owner.token, dragChild.id);
  expect(
    dragChildAfter.ok,
    `getDocument: ${dragChildAfter.status} ${JSON.stringify(dragChildAfter.error)}`,
  ).toBe(true);
  expect(dragChildAfter.data?.id).toBe(dragChild.id);
  expect(dragChildAfter.data?.parent_id).toBe(dragFolder.id);

  // 2. Move via the Move dialog and collision auto-rename on folder move.
  await createFolder(page, ws.owner.token, ws.wsId, "Con Nguồn", dstFolder.id);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${srcFolder.id}`);
  await table.getByRole("button", { name: "Thao tác cho Con Nguồn" }).click();
  await page.getByRole("menuitem", { name: "Di chuyển" }).click();
  const moveDialog = page.getByRole("dialog", { name: "Di chuyển" });
  await expect(moveDialog).toBeVisible();
  await moveDialog.getByRole("button", { name: "Đích", exact: true }).click();
  await moveDialog.getByRole("button", { name: "Di chuyển" }).click();
  await expect(moveDialog).toBeHidden();

  const movedSub = await getDocument(page, ws.owner.token, subFolder.id);
  expect(
    movedSub.ok,
    `getDocument: ${movedSub.status} ${JSON.stringify(movedSub.error)}`,
  ).toBe(true);
  expect(movedSub.data?.parent_id).toBe(dstFolder.id);
  expect(movedSub.data?.title).toBe("Con Nguồn (2)");
  const movedDoc = await getDocument(page, ws.owner.token, fileDoc.id);
  expect(
    movedDoc.ok,
    `getDocument: ${movedDoc.status} ${JSON.stringify(movedDoc.error)}`,
  ).toBe(true);
  expect(movedDoc.data?.id).toBe(fileDoc.id);
  expect(movedDoc.data?.parent_id).toBe(subFolder.id);
  expect(movedDoc.data?.breadcrumbs?.map((b) => b.title)).toEqual([
    "Đích",
    "Con Nguồn (2)",
  ]);

  // 3. Two-session realtime update: User A has srcFolder open and a second tab with search results open;
  // User B (in a second browser context) moves a folder out of srcFolder into dstFolder;
  // User A's tree, open folder content, and open search result list update without reload.
  const liveFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Hồ sơ Realtime Move",
    srcFolder.id,
  );
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${srcFolder.id}`);
  await expect(contentRow(page, "Hồ sơ Realtime Move")).toBeVisible();

  const searchPageA = await page.context().newPage();
  await searchPageA.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);
  const searchInputA = searchPageA.getByRole("searchbox", {
    name: "Tìm trong Documents",
  });
  await searchInputA.fill("Hồ sơ Realtime Move");
  const resultsListA = searchPageA.getByRole("list", {
    name: "Tìm trong Documents",
  });
  await expect(
    resultsListA.getByText("Đường dẫn: Nguồn"),
  ).toBeVisible();

  const contextB = await browser.newContext();
  try {
    const pageB = await contextB.newPage();
    await loginFolderUser(pageB, ws.member!.email);
    await pageB.goto(
      `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${srcFolder.id}`,
    );
    const moveResB = await moveDocument(
      pageB,
      ws.member!.token,
      liveFolder.id,
      {
        parent_id: dstFolder.id,
        revision: liveFolder.revision,
      },
    );
    expect(
      moveResB.ok,
      `move: ${moveResB.status} ${JSON.stringify(moveResB.error)}`,
    ).toBe(true);

    // User A's open folder content and search result path update via WebSocket invalidation without reload.
    await expect(contentRow(page, "Hồ sơ Realtime Move")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(
      resultsListA.getByText("Đường dẫn: Đích"),
    ).toBeVisible({ timeout: 15_000 });
    const expandDst = tree.getByRole("button", { name: "Mở rộng Đích" });
    if (await expandDst.isVisible()) {
      await expandDst.click();
    }
    await expect(
      tree.getByRole("treeitem", { name: "Hồ sơ Realtime Move" }),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await searchPageA.close();
    await contextB.close();
  }

  // 4. Depth + subtree height <= 20 is accepted; > 20 is rejected with 422 document_too_deep.
  const chain = await createFolderChain(
    page,
    ws.owner.token,
    ws.wsId,
    19,
    "SâuMove",
  );
  const level18 = chain[17]!;
  const level19 = chain[18]!;
  const branch2 = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Nhánh 2 cấp",
  );
  await createFolder(page, ws.owner.token, ws.wsId, "Nhánh con", branch2.id);

  const tooDeepMove = await moveDocument(page, ws.owner.token, branch2.id, {
    parent_id: level19.id,
    revision: branch2.revision,
  });
  expect(
    tooDeepMove.status,
    `${tooDeepMove.status} ${JSON.stringify(tooDeepMove.error)}`,
  ).toBe(422);
  expect(tooDeepMove.error?.code).toBe("document_too_deep");

  const okAt20Move = await moveDocument(page, ws.owner.token, branch2.id, {
    parent_id: level18.id,
    revision: branch2.revision,
  });
  expect(
    okAt20Move.ok,
    `move: ${okAt20Move.status} ${JSON.stringify(okAt20Move.error)}`,
  ).toBe(true);
  expect(okAt20Move.data?.parent_id).toBe(level18.id);
});

test("FD-A05 (FD-09 UI) tree-shaped Move-to picker disables >20 depth targets and shows move toast", async ({
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
  await picker.getByRole("treeitem", { name: /Thư mục Đích/ }).click();
  await picker.getByRole("button", { name: "Di chuyển" }).click();
  await expect(page.getByText("Đã chuyển tới Thư mục Đích")).toBeVisible();
});

test("FD-A06 moving folder into itself or a descendant is rejected with 422 document_cycle and blocked in tree drag-and-drop", async ({
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
    expect(
      res.status,
      `move(${targetId}): ${res.status} ${JSON.stringify(res.error)}`,
    ).toBe(422);
    expect(res.error?.code).toBe("document_cycle");
  }

  // Dragging Cấp A onto its descendant Cấp B in the tree is refused with toast and no move request.
  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${folderB.id}`);
  await expect(contentRow(page, "Cấp C")).toBeVisible();
  const tree = page.getByRole("tree", { name: "Cây tài liệu" });
  const itemA = tree.getByRole("treeitem", { name: "Cấp A" });
  const itemB = tree.getByRole("treeitem", { name: "Cấp B" });
  await expect(itemA).toBeVisible();
  await expect(itemB).toBeVisible();
  const boxA = await itemA.boundingBox();
  const boxB = await itemB.boundingBox();
  expect(boxA && boxB).toBeTruthy();
  await page.mouse.move(boxA!.x + boxA!.width / 2, boxA!.y + boxA!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    boxA!.x + boxA!.width / 2 + 10,
    boxA!.y + boxA!.height / 2 + 10,
    { steps: 5 },
  );
  await page.mouse.move(boxB!.x + boxB!.width / 2, boxB!.y + boxB!.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(
    page.getByText(
      "Không thể chuyển thư mục vào chính nó hoặc thư mục con của nó.",
    ),
  ).toBeVisible();

  const treeAfter = await getDocumentTree(page, ws.owner.token, ws.wsId, {
    folders_only: true,
  });
  expect(treeAfter.length).toBe(1);
  expect(treeAfter[0]?.id).toBe(folderA.id);
  expect(treeAfter[0]?.children[0]?.id).toBe(folderB.id);
  expect(treeAfter[0]?.children[0]?.children[0]?.id).toBe(folderC.id);
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

test("FD-A07 moving a document between folders keeps ID, versions, and comments with no second row and renames Name (n).ext on collision", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a07", { withMemberB: true });
  const folderA = await createFolder(page, ws.owner.token, ws.wsId, "Phòng A");
  const folderB = await createFolder(page, ws.owner.token, ws.wsId, "Phòng B");

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
  await seedDocumentArtifacts(page, ws.owner.token, docxB.id, ws.member!.id);
  const beforeArtifacts = await readDocumentArtifacts(
    page,
    ws.owner.token,
    docxB.id,
  );

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${folderB.id}`);
  const table = page.getByRole("table", { name: "Tài liệu" });
  await table.getByRole("button", { name: "Thao tác cho report.docx" }).click();
  await page.getByRole("menuitem", { name: "Di chuyển" }).click();
  const moveDialog = page.getByRole("dialog", { name: "Di chuyển" });
  await moveDialog.getByRole("button", { name: "Phòng A", exact: true }).click();
  await moveDialog.getByRole("button", { name: "Di chuyển" }).click();
  await expect(moveDialog).toBeHidden();

  const movedDocx = await getDocument(page, ws.owner.token, docxB.id);
  expect(
    movedDocx.ok,
    `getDocument: ${movedDocx.status} ${JSON.stringify(movedDocx.error)}`,
  ).toBe(true);
  expect(movedDocx.data?.id).toBe(docxB.id);
  expect(movedDocx.data?.parent_id).toBe(folderA.id);
  expect(movedDocx.data?.title).toBe("report (2).docx");

  const afterArtifacts = await readDocumentArtifacts(
    page,
    ws.owner.token,
    docxB.id,
  );
  expect(afterArtifacts).toEqual(beforeArtifacts);

  const listB = await listDocuments(page, ws.owner.token, ws.wsId, {
    parent_id: folderB.id,
  });
  expect(listB.documents).toHaveLength(0);

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
  expect(
    movedMd.ok,
    `move: ${movedMd.status} ${JSON.stringify(movedMd.error)}`,
  ).toBe(true);
  expect(movedMd.data?.title).toBe("notes (2).md");

  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${folderA.id}`);
  for (const [name, typeLabel] of [
    ["report.docx", "Tài liệu Word"],
    ["report (2).docx", "Tài liệu Word"],
    ["notes.md", "Tài liệu Markdown"],
    ["notes (2).md", "Tài liệu Markdown"],
  ] as const) {
    const row = contentRow(page, name);
    await expect(row).toBeVisible();
    await expect(row.getByRole("img", { name: typeLabel })).toBeVisible();
  }
});

test("FD-A07 (FD-09 UI) moving colliding item via Move-to picker disables current location and shows toast Đã chuyển và đổi tên thành", async ({
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
  await expect(picker.getByText("Vị trí hiện tại")).toBeVisible();
  await picker.getByRole("treeitem", { name: /Phòng A/ }).click();
  await picker.getByRole("button", { name: "Di chuyển" }).click();
  await expect(
    page.getByText("Đã chuyển và đổi tên thành Bản thảo (2)"),
  ).toBeVisible();
});

test("FD-A08 breadcrumb navigates segments, follows browser Back/Forward, omits unreadable ancestors, and shows error state on invalid/archived/forbidden ?folder=", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a08", { withMemberB: true });
  const level1 = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Khối Kỹ thuật",
  );
  const level2 = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Nền tảng",
    level1.id,
  );
  const level3 = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Kiến trúc",
    level2.id,
  );

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${level3.id}`);

  const breadcrumb = page.getByRole("navigation", {
    name: "Đường dẫn thư mục",
  });
  await expect(breadcrumb).toBeVisible();
  await expect(
    breadcrumb.getByRole("button", { name: "Tài liệu" }),
  ).toBeVisible();
  await expect(
    breadcrumb.getByRole("button", { name: "Khối Kỹ thuật" }),
  ).toBeVisible();
  await expect(
    breadcrumb.getByRole("button", { name: "Nền tảng" }),
  ).toBeVisible();
  await expect(breadcrumb.getByText("Kiến trúc")).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Clicking ancestor segments navigates and browser Back/Forward follow.
  await breadcrumb.getByRole("button", { name: "Khối Kỹ thuật" }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${level1.id}`));
  await expect(breadcrumb.getByText("Khối Kỹ thuật")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(contentRow(page, "Nền tảng")).toBeVisible();

  await breadcrumb.getByRole("button", { name: "Tài liệu" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${ws.orgSlug}/${ws.wsSlug}/documents$`),
  );

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`folder=${level1.id}`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`folder=${level3.id}`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`folder=${level1.id}`));

  // Unknown and archived ?folder= show the error state with link to root (never an empty list).
  const archivedFolder = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Đã Xóa",
  );
  const archivedRes = await archiveDocument(
    page,
    ws.owner.token,
    archivedFolder.id,
  );
  expect(
    archivedRes.ok,
    `archiveDocument: ${archivedRes.status} ${JSON.stringify(archivedRes.error)}`,
  ).toBe(true);

  for (const badId of ["01INVALIDFOLDER000000000000", archivedFolder.id]) {
    await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${badId}`);
    await expect(
      page.getByRole("alert").getByText("Không mở được thư mục này"),
    ).toBeVisible();
    await expect(page.getByText("Thư mục này chưa có gì")).toHaveCount(0);
    await page.getByRole("link", { name: "Về Documents (gốc)" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${ws.orgSlug}/${ws.wsSlug}/documents$`),
    );
  }

  // Unreadable ancestor is omitted from breadcrumb, and forbidden ?folder= shows error state.
  const secretRoot = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Cha Bí Mật",
    null,
    "restricted",
  );
  const sharedChild = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Con Được Chia Sẻ",
    secretRoot.id,
    "restricted",
  );
  await grantDocumentShare(
    page,
    ws.owner.token,
    sharedChild.id,
    ws.member!.id,
    "view",
  );

  await loginFolderUser(page, ws.member!.email);
  await page.goto(
    `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${sharedChild.id}`,
  );
  await expect(
    breadcrumb.getByText("Thư mục Con Được Chia Sẻ"),
  ).toHaveAttribute("aria-current", "page");
  await expect(breadcrumb.getByText("Thư mục Cha Bí Mật")).toHaveCount(0);

  await page.goto(
    `/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${secretRoot.id}`,
  );
  await expect(
    page.getByRole("alert").getByText("Không mở được thư mục này"),
  ).toBeVisible();
  await expect(page.getByText("Thư mục Cha Bí Mật")).toHaveCount(0);
  await page.getByRole("link", { name: "Về Documents (gốc)" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${ws.orgSlug}/${ws.wsSlug}/documents$`),
  );
});

test("FD-A08 (FD-09 UI) deep breadcrumb collapses >4 levels into keyboard-reachable menu Các cấp ẩn", async ({
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

test("FD-A09 unified search and ⌘K find folders and documents by title, filter by kind, show paths, omit unreadable ancestors, and exclude body-only matches", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a09", { withMemberB: true });
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
  await createPage(
    page,
    ws.owner.token,
    ws.wsId,
    "Trang ghi chú nội bộ",
    null,
    {
      bodyText: "Chuỗi bí mật chỉ nằm trong thân bài BODYONLYTOKEN99",
    },
  );

  // Restricted ancestor with a shared child folder to verify search path never leaks unreadable ancestor.
  const restrictedParent = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Cha Ẩn",
    null,
    "restricted",
  );
  const sharedLeaf = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Hợp đồng Chia Sẻ Riêng",
    restrictedParent.id,
    "restricted",
  );
  await grantDocumentShare(
    page,
    ws.owner.token,
    sharedLeaf.id,
    ws.member!.id,
    "view",
  );

  const memberSearch = await listDocuments(page, ws.member!.token, ws.wsId, {
    q: "Hop dong Chia Se Rieng",
    match: "title",
  });
  const foundLeaf = memberSearch.documents.find((d) => d.id === sharedLeaf.id);
  expect(foundLeaf).toBeTruthy();
  expect(
    (foundLeaf?.path ?? []).some(
      (seg) => seg.id === restrictedParent.id || seg.title === "Thư mục Cha Ẩn",
    ),
  ).toBe(false);

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
    resultsList.getByText("Đường dẫn: Tài chính 2026 › Quý 1").first(),
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
  // packages/views/search/search-command.tsx:121 & packages/core/i18n/locales/vi.json:389 ("Gõ trang hoặc lệnh…").
  const cmdInput = cmdDialog.getByPlaceholder("Gõ trang hoặc lệnh…");
  await expect(cmdInput).toBeVisible();
  await cmdInput.fill("Quý 1");
  await cmdDialog
    .getByRole("option", { name: "Quý 1 Đường dẫn: Tài chính 2026", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`folder=${q1Folder.id}`));
});

test("FD-A10 moving a document or its folder preserves ID, versions, comments, shares, task/meeting/chat links, and Từ nơi khác listing", async ({
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
  // seedDocumentArtifacts commits version 2 on file documents (bumping revision 1 -> 2),
  // so use its returned fresh DocumentDTO revision when moving.
  const seededDoc = await seedDocumentArtifacts(
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
  expect(
    taskRes.ok(),
    `create task: ${taskRes.status()} ${await taskRes.text()}`,
  ).toBeTruthy();
  const taskId = ((await taskRes.json()) as { task: { id: string } }).task.id;

  // Attach a file on the task so it appears in "Từ nơi khác" (GET /documents/sources & ?view=sources).
  const sourceFileName = "tai-lieu-tu-noi-khac-fd-a10.txt";
  const attachRes = await page.request.post(
    `${e2eApiUrl}/api/v1/tasks/${taskId}/attachments`,
    {
      headers: { authorization: `Bearer ${ws.owner.token}` },
      multipart: {
        file: {
          name: sourceFileName,
          mimeType: "text/plain",
          buffer: Buffer.from("Nội dung đính kèm công việc FD-A10\n"),
        },
      },
    },
  );
  expect(
    attachRes.ok(),
    `attach task file: ${attachRes.status()} ${await attachRes.text()}`,
  ).toBeTruthy();

  const sourcesBefore = await listDocumentSources(
    page,
    ws.owner.token,
    ws.wsId,
    "task",
  );
  expect(sourcesBefore.some((s) => s.name === sourceFileName)).toBe(true);

  // Instant meeting route per server/internal/handler/isolation_world_test.go:602.
  const meetingRes = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/meetings/instant`,
    {
      headers: authJson,
      data: { title: `Họp duyệt ${docUrl}` },
    },
  );
  expect(
    meetingRes.ok(),
    `create meeting: ${meetingRes.status()} ${await meetingRes.text()}`,
  ).toBeTruthy();

  // Public channel + room message per server/internal/handler/isolation_world_test.go:622-625.
  const chanRes = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/channels`,
    {
      headers: authJson,
      data: { name: "fd-a10-channel", visibility: "public" },
    },
  );
  expect(
    chanRes.ok(),
    `create channel: ${chanRes.status()} ${await chanRes.text()}`,
  ).toBeTruthy();
  const chanBody = (await chanRes.json()) as {
    room?: { id: string };
    channel?: { id: string };
  };
  const roomId = chanBody.room?.id ?? chanBody.channel?.id;
  expect(roomId).toBeTruthy();

  const chatRes = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/rooms/${roomId}/messages`,
    {
      headers: authJson,
      data: {
        body: `Tài liệu đính kèm: ${docUrl}`,
        client_msg_id: `msg-fda10-${Date.now()}`,
      },
    },
  );
  expect(
    chatRes.ok(),
    `send chat message: ${chatRes.status()} ${await chatRes.text()}`,
  ).toBeTruthy();

  // Move the document to folderB, then move folderB into folderA.
  const moved = await moveDocument(page, ws.owner.token, doc.id, {
    parent_id: folderB.id,
    revision: seededDoc.revision,
  });
  expect(
    moved.ok,
    `move: ${moved.status} ${JSON.stringify(moved.error)}`,
  ).toBe(true);
  expect(moved.data?.id).toBe(doc.id);
  expect(moved.data?.parent_id).toBe(folderB.id);

  const movedFolder = await moveDocument(page, ws.owner.token, folderB.id, {
    parent_id: folderA.id,
    revision: folderB.revision,
  });
  expect(
    movedFolder.ok,
    `moveFolder: ${movedFolder.status} ${JSON.stringify(movedFolder.error)}`,
  ).toBe(true);

  const after = await readDocumentArtifacts(page, ws.owner.token, doc.id);
  expect(after).toEqual(before);

  const listNew = await listDocuments(page, ws.owner.token, ws.wsId, {
    parent_id: folderB.id,
  });
  expect(listNew.documents.map((d) => d.id)).toEqual([doc.id]);

  // "Từ nơi khác" API and UI still list the source item after document and folder moves.
  const sourcesAfter = await listDocumentSources(
    page,
    ws.owner.token,
    ws.wsId,
    "task",
  );
  expect(sourcesAfter.some((s) => s.name === sourceFileName)).toBe(true);

  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);
  const sidebar = page.getByRole("navigation", { name: "Điều hướng tài liệu" });
  await expect(sidebar.getByText("Từ nơi khác")).toBeVisible();
  await sidebar.getByRole("button", { name: "Công việc" }).click();
  await expect(page.getByText(sourceFileName).first()).toBeVisible();

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

test("FD-A11 prevents duplicate sibling folder names (case-insensitive, accent-sensitive NFC, concurrent race, restricted leak check) while allowing same-name documents", async ({
  page,
}) => {
  const ws = await seedFolderWorkspace(page, "fd-a11", { withMemberB: true });
  const parent = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Thư mục Cha",
  );

  // 1. Create "Hợp đồng" and verify case-insensitive & NFD duplicates return 409 folder_name_taken.
  await createFolder(page, ws.owner.token, ws.wsId, "Hợp đồng", parent.id);

  const upperDup = await apiCreateDocument(page, ws.owner.token, ws.wsId, {
    title: "HỢP ĐỒNG",
    kind: "folder",
    parent_id: parent.id,
  });
  expect(
    upperDup.status,
    `${upperDup.status} ${JSON.stringify(upperDup.error)}`,
  ).toBe(409);
  expect(upperDup.error?.code).toBe("folder_name_taken");

  const nfdDup = await apiCreateDocument(page, ws.owner.token, ws.wsId, {
    title: "Hợp đồng".normalize("NFD"),
    kind: "folder",
    parent_id: parent.id,
  });
  expect(
    nfdDup.status,
    `${nfdDup.status} ${JSON.stringify(nfdDup.error)}`,
  ).toBe(409);
  expect(nfdDup.error?.code).toBe("folder_name_taken");

  // 2. Accent-sensitive: "Ma" and "Mã" are distinct and both succeed under the same parent.
  const folderMa = await apiCreateDocument(page, ws.owner.token, ws.wsId, {
    title: "Ma",
    kind: "folder",
    parent_id: parent.id,
  });
  expect(
    folderMa.status,
    `${folderMa.status} ${JSON.stringify(folderMa.error)}`,
  ).toBe(201);
  const folderMaAccent = await apiCreateDocument(
    page,
    ws.owner.token,
    ws.wsId,
    {
      title: "Mã",
      kind: "folder",
      parent_id: parent.id,
    },
  );
  expect(
    folderMaAccent.status,
    `${folderMaAccent.status} ${JSON.stringify(folderMaAccent.error)}`,
  ).toBe(201);

  // 3. Two concurrent creates with the same name under the same parent yield one 201 and one 409.
  // server/internal/service/document_names.go:73-74 (normalizeDocumentTitle) applies norm.NFC(strings.TrimSpace(raw))
  // and server/pkg/db/queries/document_names.sql:16-34 compares lower(title COLLATE "und-x-icu").
  const [race1, race2] = await Promise.all([
    apiCreateDocument(
      page,
      ws.owner.token,
      ws.wsId,
      {
        title: " Đua Song Song ",
        kind: "folder",
        parent_id: parent.id,
      },
      `race-1-${Date.now()}`,
    ),
    apiCreateDocument(
      page,
      ws.owner.token,
      ws.wsId,
      {
        title: "đua song song",
        kind: "folder",
        parent_id: parent.id,
      },
      `race-2-${Date.now()}`,
    ),
  ]);
  expect(
    [race1.status, race2.status].sort(),
    `race1=${race1.status} (${JSON.stringify(race1.error)}), race2=${race2.status} (${JSON.stringify(race2.error)})`,
  ).toEqual([201, 409]);

  // 4. Same-name documents (pages and files) under the same parent are allowed (201).
  const page1 = await apiCreateDocument(page, ws.owner.token, ws.wsId, {
    title: "Biên bản trùng tên",
    kind: "page",
    parent_id: parent.id,
  });
  const page2 = await apiCreateDocument(page, ws.owner.token, ws.wsId, {
    title: "Biên bản trùng tên",
    kind: "page",
    parent_id: parent.id,
  });
  expect(page1.status, `${page1.status} ${JSON.stringify(page1.error)}`).toBe(
    201,
  );
  expect(page2.status, `${page2.status} ${JSON.stringify(page2.error)}`).toBe(
    201,
  );
  const file1 = await uploadFixtureFile(
    page,
    ws.owner.token,
    ws.wsId,
    "fx-docx-report-vi",
    { parentId: parent.id, title: "bao-cao-trung.docx" },
  );
  const file2 = await uploadFixtureFile(
    page,
    ws.owner.token,
    ws.wsId,
    "fx-docx-report-vi",
    { parentId: parent.id, title: "bao-cao-trung.docx" },
  );
  expect(file1.id).not.toBe(file2.id);

  // 5. Restricted sibling folder collision: 409 response to User B carries NO id or title of A's restricted folder.
  const restrictedSibling = await createFolder(
    page,
    ws.owner.token,
    ws.wsId,
    "Dự Án Mật Của Owner",
    parent.id,
    "restricted",
  );
  const blindCollision = await apiCreateDocument(
    page,
    ws.member!.token,
    ws.wsId,
    {
      title: "dự án mật của owner",
      kind: "folder",
      parent_id: parent.id,
    },
  );
  expect(
    blindCollision.status,
    `${blindCollision.status} ${JSON.stringify(blindCollision.error)}`,
  ).toBe(409);
  expect(blindCollision.error?.code).toBe("folder_name_taken");
  expect(blindCollision.rawText).not.toContain(restrictedSibling.id);
  expect(blindCollision.rawText).not.toContain(restrictedSibling.title);

  // 6. Both create and rename surface 409 as a field error (role="alert") in the dialog.
  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents?folder=${parent.id}`);

  await page.getByRole("button", { name: "Tạo mới", exact: true }).click();
  await page.getByRole("menuitem", { name: "Thư mục" }).click();
  const createDlg = page.getByRole("dialog", {
    name: "Thư mục con mới trong Thư mục Cha",
  });
  await createDlg.getByLabel("Tên thư mục").fill("HỢP ĐỒNG");
  await createDlg.getByRole("button", { name: "Tạo" }).click();
  await expect(createDlg.getByRole("alert")).toContainText(
    "Đã có thư mục tên này ở đây. Hãy đặt tên khác.",
  );
  await createDlg.getByLabel("Tên thư mục").press("Escape");
  await expect(createDlg).toBeHidden();

  const table = page.getByRole("table", { name: "Tài liệu" });
  await table.getByRole("button", { name: "Thao tác cho Ma" }).click();
  await page.getByRole("menuitem", { name: "Đổi tên" }).click();
  const renameDlg = page.getByRole("dialog", { name: "Đổi tên thư mục" });
  await renameDlg.getByLabel("Tên thư mục").fill("Hợp đồng");
  await renameDlg.getByRole("button", { name: "Lưu" }).click();
  await expect(renameDlg.getByRole("alert")).toContainText(
    "Đã có thư mục tên này ở đây. Hãy đặt tên khác.",
  );
});

test("FD-A12 archiving and restoring folder subtree counts items, updates a second session live, renames on restore collision, and blocks 403", async ({
  page,
  browser,
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

  // server/internal/service/document_lifecycle.go:356-383 (GetDocumentArchiveImpact) counts
  // descendant folders (sub1, sub2 = 2), descendant documents (doc1, doc2, doc3 = 3), and total (root + 5 = 6).
  const impact = await getArchiveImpact(page, ws.owner.token, rootFolder.id);
  expect(impact.ok, `${impact.status} ${JSON.stringify(impact.error)}`).toBe(
    true,
  );
  expect(impact.data).toMatchObject({
    folders: 2,
    documents: 3,
    total: 6,
    too_large: false,
  });

  // Two-session live update: User A has the workspace root & a search tab open;
  // User B (or owner from a second browser context) archives then restores rootFolder;
  // User A's sidebar tree, table content, and open search results update without reload.
  await loginFolderUser(page, ws.owner.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);
  const tree = page.getByRole("tree", { name: "Cây tài liệu" });
  await expect(
    tree.getByRole("treeitem", { name: "Dự án Đóng" }),
  ).toBeVisible();
  await expect(contentRow(page, "Dự án Đóng")).toBeVisible();

  const searchPageA = await page.context().newPage();
  await searchPageA.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);
  const searchInputA = searchPageA.getByRole("searchbox", {
    name: "Tìm trong Documents",
  });
  await searchInputA.fill("Dự án Đóng");
  const resultsListA = searchPageA.getByRole("list", {
    name: "Tìm trong Documents",
  });
  await expect(resultsListA.getByText("Dự án Đóng")).toBeVisible();

  const contextB = await browser.newContext();
  try {
    const pageB = await contextB.newPage();
    await loginFolderUser(pageB, ws.member!.email);
    await pageB.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);

    const archived = await archiveDocument(
      pageB,
      ws.owner.token,
      rootFolder.id,
    );
    expect(
      archived.ok,
      `${archived.status} ${JSON.stringify(archived.error)}`,
    ).toBe(true);
    expect(archived.data?.affected.sort()).toEqual(
      [rootFolder.id, sub1.id, sub2.id, doc1.id, doc2.id, doc3.id].sort(),
    );

    await expect(
      tree.getByRole("treeitem", { name: "Dự án Đóng" }),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(contentRow(page, "Dự án Đóng")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(
      searchPageA.getByText("Không tìm thấy kết quả"),
    ).toBeVisible({ timeout: 15_000 });

    // Create a new folder with the same name while rootFolder is in trash so restore collides and auto-renames.
    await createFolder(pageB, ws.owner.token, ws.wsId, "Dự án Đóng");
    const restored = await restoreDocument(
      pageB,
      ws.owner.token,
      rootFolder.id,
    );
    expect(
      restored.ok,
      `${restored.status} ${JSON.stringify(restored.error)}`,
    ).toBe(true);
    expect(restored.data?.document.title).toBe("Dự án Đóng (2)");

    await expect(
      tree.getByRole("treeitem", { name: "Dự án Đóng (2)" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(contentRow(page, "Dự án Đóng (2)")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      resultsListA.getByText("Dự án Đóng (2)"),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await searchPageA.close();
    await contextB.close();
  }

  const doc1After = await getDocument(page, ws.owner.token, doc1.id);
  expect(
    doc1After.ok,
    `getDocument: ${doc1After.status} ${JSON.stringify(doc1After.error)}`,
  ).toBe(true);
  expect(doc1After.data?.parent_id).toBe(sub1.id);
  // server/internal/handler/documents.go:868-871 omits archived_at when doc.ArchivedAt is null.
  expect(doc1After.data?.archived_at).toBeUndefined();

  // Unmanageable descendant: B cannot archive a folder containing A's document (403).
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
  expect(
    impactB.status,
    `${impactB.status} ${JSON.stringify(impactB.error)}`,
  ).toBe(403);
  const archiveB = await archiveDocument(page, ws.member!.token, folderB.id);
  expect(
    archiveB.status,
    `${archiveB.status} ${JSON.stringify(archiveB.error)}`,
  ).toBe(403);
  const childOfAAfter = await getDocument(page, ws.owner.token, childOfA.id);
  expect(
    childOfAAfter.ok,
    `getDocument: ${childOfAAfter.status} ${JSON.stringify(childOfAAfter.error)}`,
  ).toBe(true);
  expect(childOfAAfter.data?.archived_at).toBeUndefined();
});

test("FD-A12 tree over 1000 nodes reports too_large on archive-impact and blocks archive with 422 folder_too_large", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  const ws = await seedFolderWorkspace(page, "fd-a12-1000");
  // Subtree > 1000 nodes (hugeFolder + 1000 child pages = 1001 total nodes):
  // archive-impact reports too_large: true and archive refuses with 422 folder_too_large.
  // Seeding throttles to <= 240 requests per rolling minute (batches of 40 + wait) to stay under
  // the server's 300 req/min per-identity limiter (server/internal/handler/router/router.go:90).
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
    40,
  );
  const hugeImpact = await getArchiveImpact(
    page,
    ws.owner.token,
    hugeFolder.id,
  );
  expect(
    hugeImpact.ok,
    `${hugeImpact.status} ${JSON.stringify(hugeImpact.error)}`,
  ).toBe(true);
  expect(hugeImpact.data?.too_large).toBe(true);
  const hugeArchive = await archiveDocument(
    page,
    ws.owner.token,
    hugeFolder.id,
  );
  expect(
    hugeArchive.status,
    `${hugeArchive.status} ${JSON.stringify(hugeArchive.error)}`,
  ).toBe(422);
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
      "1 thư mục con và 1 tài liệu sẽ chuyển vào thùng rác, khôi phục được trong 30 ngày.",
    ),
  ).toBeVisible();
  await dlg.getByRole("button", { name: "Xóa" }).click();
  await expect(page.getByText("Đã chuyển Xóa Thử vào thùng rác")).toBeVisible();
});
