import { expect, test, type APIRequestContext } from "@playwright/test";
import { libraryRowButton } from "./documents-onboard";
import {
  api,
  authHeaders,
  buildShareScene,
  docPath,
  grantAccess,
  openSession,
  readDoc,
  userItem,
  type ShareScene,
} from "./documents-share-fixtures";

/**
 * UNI-1974 (FOLDER-SHARE-OFF), as ADR 0037 (UNI-2055) leaves it: only
 * documents are shared, and a shared document is never attached to a folder of
 * the owner's My Folder on the recipient's side. An owner shares a page from
 * My Folder and a page from a folder inside My Folder (the only private
 * folders now: every folder outside My Folder is workspace-wide and shows its
 * path); the recipient finds both on their own in Shared with me, search and
 * the detail view, with no parent id, no path and no breadcrumb. A folder
 * itself refuses every share (422 folder_not_shareable), and its visibility
 * follows its location, whatever the client asks for.
 *
 * Needs the same runtime as documents-share.spec.ts (FF_DOCUMENTS on, the
 * worktree's migrations applied, Team plan seeded by the fixture scene). Run
 * by the cloud runner, not locally.
 */
test.describe.configure({ timeout: 360_000 });

const tag = `fso1974-${Date.now().toString(36)}`;
const stamp = Date.now().toString(36);

let s: ShareScene;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  const page = await browser.newPage();
  try {
    s = await buildShareScene(page, tag, 0);
  } finally {
    await page.close();
  }
});

interface Row {
  id: string;
  title: string;
  parent_id?: string | null;
  path?: unknown[];
}

async function create(request: APIRequestContext, body: Record<string, unknown>): Promise<Row> {
  const res = await request.post(`${api}/api/v1/workspaces/${s.m.aOwner.wsId}/documents`, {
    headers: authHeaders(s.owner.token),
    data: body,
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { document: Row }).document;
}

async function documents(request: APIRequestContext, path: string): Promise<Row[]> {
  const res = await request.get(`${api}/api/v1/workspaces/${s.m.aOwner.wsId}/documents${path}`, {
    headers: authHeaders(s.member.token),
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { documents: Row[] }).documents;
}

test("a page shared from My Folder or a private folder shows on its own for the recipient", async ({ browser, request }) => {
  const folderTitle = `Thư mục riêng của chủ ${stamp}`;
  const myFolderTitle = `Trang từ Thư mục của tôi ${stamp}`;
  const folderedTitle = `Trang trong thư mục ${stamp}`;

  const folder = await create(request, { kind: "folder", title: folderTitle, destination: "my_folder" });
  const fromMyFolder = await create(request, { kind: "page", title: myFolderTitle, destination: "my_folder" });
  const inFolder = await create(request, { kind: "page", title: folderedTitle, parent_id: folder.id });
  for (const doc of [fromMyFolder, inFolder]) {
    await grantAccess(request, s.owner.token, doc.id, [userItem(s.member, "view")]);
  }

  await test.step("the folder itself takes no share, and its visibility follows its location", async () => {
    const share = await request.put(`${api}/api/v1/documents/${folder.id}/access`, {
      headers: authHeaders(s.owner.token),
      data: { items: [userItem(s.member, "view")] },
    });
    expect(share.status(), await share.text()).toBe(422);
    expect(((await share.json()) as { error: { code: string } }).error.code).toBe("folder_not_shareable");

    // PATCH never moves a folder's visibility either way.
    const read = await request.get(`${api}/api/v1/documents/${folder.id}`, { headers: authHeaders(s.owner.token) });
    expect(read.status(), await read.text()).toBe(200);
    const revision = ((await read.json()) as { document: { revision: string } }).document.revision;
    const patch = await request.patch(`${api}/api/v1/documents/${folder.id}`, {
      headers: authHeaders(s.owner.token),
      data: { revision, visibility: "workspace" },
    });
    expect(patch.status(), await patch.text()).toBe(422);
    expect(((await patch.json()) as { error: { code: string } }).error.code).toBe("folder_not_shareable");

    // A client visibility on a folder create is ignored: inside My Folder it is restricted,
    // outside it is workspace-wide (ADR 0037).
    const asked = await request.post(`${api}/api/v1/workspaces/${s.m.aOwner.wsId}/documents`, {
      headers: authHeaders(s.owner.token),
      data: { kind: "folder", title: `Thư mục riêng mở ${stamp}`, destination: "my_folder", visibility: "workspace" },
    });
    expect(asked.status(), await asked.text()).toBe(201);
    expect(((await asked.json()) as { document: { visibility: string } }).document.visibility).toBe("restricted");
    const rootFolder = await request.post(`${api}/api/v1/workspaces/${s.m.aOwner.wsId}/documents`, {
      headers: authHeaders(s.owner.token),
      data: { kind: "folder", title: `Thư mục chung ${stamp}`, visibility: "restricted" },
    });
    expect(rootFolder.status(), await rootFolder.text()).toBe(201);
    expect(((await rootFolder.json()) as { document: { visibility: string } }).document.visibility).toBe("workspace");
  });

  await test.step("the API names no folder to the recipient: list, search, detail", async () => {
    for (const doc of [fromMyFolder, inFolder]) {
      const detail = await readDoc(request, s.member.token, doc.id);
      expect(detail.status(), await detail.text()).toBe(200);
      const body = (await detail.json()) as { document: Row & { breadcrumbs?: unknown[] } };
      expect(body.document.parent_id ?? null, `parent_id of ${doc.title}`).toBeNull();
      expect(body.document.breadcrumbs ?? [], `breadcrumbs of ${doc.title}`).toEqual([]);

      const found = (await documents(request, `?q=${encodeURIComponent(doc.title)}&match=title`)).find((d) => d.id === doc.id);
      expect(found, `search finds ${doc.title}`).toBeTruthy();
      expect(found?.parent_id ?? null).toBeNull();
      expect(found?.path ?? []).toEqual([]);
    }
    const shared = await request.get(`${api}/api/v1/workspaces/${s.m.aOwner.wsId}/documents/shared-with-me`, {
      headers: authHeaders(s.member.token),
    });
    expect(shared.status(), await shared.text()).toBe(200);
    const rows = ((await shared.json()) as { documents: Row[] }).documents;
    for (const doc of [fromMyFolder, inFolder]) {
      const row = rows.find((d) => d.id === doc.id);
      expect(row, `Shared with me lists ${doc.title}`).toBeTruthy();
      expect(row?.parent_id ?? null).toBeNull();
    }
    expect(rows.some((d) => d.id === folder.id), "a folder is never in Shared with me").toBe(false);
  });

  await test.step("the owner's Shared by me lists the pages and never the folder", async () => {
    const res = await request.get(`${api}/api/v1/workspaces/${s.m.aOwner.wsId}/documents?shared_by_me=true`, {
      headers: authHeaders(s.owner.token),
    });
    expect(res.status(), await res.text()).toBe(200);
    const rows = ((await res.json()) as { documents: Row[] }).documents;
    expect(rows.map((d) => d.id)).toEqual(expect.arrayContaining([fromMyFolder.id, inFolder.id]));
    expect(rows.some((d) => d.id === folder.id)).toBe(false);
  });

  await test.step("the recipient's screen shows the pages without the owner's folder", async () => {
    const { context, page } = await openSession(browser, s.member.email);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/documents`);
      await page
        .getByRole("navigation", { name: "Điều hướng tài liệu" })
        .getByRole("button", { name: "Được chia sẻ với tôi" })
        .click();
      const table = page.getByRole("table", { name: "Tài liệu" });
      await expect(libraryRowButton(table, myFolderTitle)).toBeVisible({ timeout: 60_000 });
      await expect(libraryRowButton(table, folderedTitle)).toBeVisible();
      await expect(page.getByText(folderTitle)).toHaveCount(0);

      await page.goto(docPath(s.m.aOwner, inFolder.id));
      await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(folderTitle)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
