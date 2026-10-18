import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { documentMatrix, type DocumentMatrix } from "./documents-fixtures";
import { libraryRowButton, onboardDocumentsUser } from "./documents-onboard";
import { loginViaUi } from "./meeting-recording-fixture";
import { workspaceSeed } from "./onboard";
import { captureAuth } from "./tasks-seed";

/**
 * The Documents home flows of GO-D1 (UNI-1305) on the real stack: a blank Office
 * card opens its editor, a folder takes the breadcrumb, a file moves into it,
 * the "other modules" section shows only when its API answers, the header
 * "Mở UniWork Office" falls back to the installer dialog when no desktop app
 * answers, and a viewer sees neither create controls nor commands their level
 * does not allow.
 *
 * Needs the app on E2E_BASE_URL with the `documents` flag ON (FF_DOCUMENTS),
 * Postgres + Redis + storage up and this worktree's migrations applied - the
 * same environment as documents.spec.ts. Run by the cloud runner, not locally.
 */
test.describe.configure({ timeout: 360_000 });

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const stamp = Date.now();
const DOCUMENT_URL = /\/documents\/[0-9A-HJKMNP-TV-Z]{26}$/;
const DOCX_TITLE = "Tài liệu chưa đặt tên.docx";
const FOLDER_TITLE = "Thư mục mới";
const SOURCE_FILE = `ghi-chu-e2e-${stamp}.txt`;

const owner = workspaceSeed("dochome", "owner", stamp);

/** One pill of the Tạo nhanh strip at the home root (the create cards are gone; it keeps the same create flow). */
function quickCreate(page: Page, label: RegExp) {
  return page.getByRole("region", { name: "Tạo nhanh" }).getByRole("button", { name: label });
}

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Điều hướng tài liệu" });
}

function library(page: Page) {
  return page.getByRole("table", { name: "Tài liệu" });
}

async function openLibrary(page: Page, orgSlug: string, wsSlug: string) {
  await page.goto(`/${orgSlug}/${wsSlug}/documents`);
  await expect(page.getByRole("heading", { level: 1, name: "Tài liệu của workspace" })).toBeVisible({ timeout: 60_000 });
}

test("quick create, folder, move and the other-modules section on the owner's home", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboardDocumentsUser(page, owner);

  // A task attachment is a file from another module: it feeds "Từ nơi khác".
  const auth = await captureAuth(page);
  const task = await page.request.post(`${auth.api}/api/v1/workspaces/${auth.wsId}/tasks`, {
    headers: { authorization: auth.auth, "content-type": "application/json" },
    data: { title: `Việc có tệp ${stamp}` },
  });
  expect(task.status(), await task.text()).toBe(200);
  const taskId = ((await task.json()) as { task: { id: string } }).task.id;
  const attached = await page.request.post(`${auth.api}/api/v1/tasks/${taskId}/attachments`, {
    headers: { authorization: auth.auth },
    multipart: { file: { name: SOURCE_FILE, mimeType: "text/plain", buffer: Buffer.from(`ghi chú ${stamp}\n`) } },
  });
  expect(attached.status(), await attached.text()).toBe(200);

  // 1. A blank docx from its quick-create pill: created in My Folder (destination: "my_folder") and opened at once.
  await openLibrary(page, owner.orgSlug, owner.wsSlug);
  await quickCreate(page, /^Văn bản/).click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 90_000 });
  // The Office module frame mounts on the document page; its inner title is the
  // module's own text, so the check is the frame element, not what it renders.
  await expect(page.locator('iframe[src*="/office-frame/"]').first()).toBeAttached({ timeout: 60_000 });

  // 2. A folder: named in the FD-07/08 name dialog (as documents-folders.spec.ts does), opened,
  // listed in the sidebar tree and named in the breadcrumb.
  await openLibrary(page, owner.orgSlug, owner.wsSlug);
  await sidebar(page).getByRole("button", { name: "Thư mục của tôi", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thư mục của tôi", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(libraryRowButton(library(page), DOCX_TITLE)).toBeVisible({ timeout: 30_000 });
  await sidebar(page).getByRole("button", { name: "Tạo thư mục" }).click();
  const nameDialog = page.getByRole("dialog", { name: "Thư mục mới ở Tài liệu (gốc)" });
  await nameDialog.getByLabel("Tên thư mục").fill(FOLDER_TITLE);
  await nameDialog.getByRole("button", { name: "Tạo" }).click();
  await expect(nameDialog).toBeHidden({ timeout: 30_000 });
  await expect(sidebar(page).getByRole("treeitem", { name: new RegExp(FOLDER_TITLE) })).toBeVisible({ timeout: 30_000 });
  const crumbs = page.getByRole("navigation", { name: "Đường dẫn thư mục" });
  await expect(crumbs).toBeVisible({ timeout: 30_000 });
  await expect(crumbs.getByText(FOLDER_TITLE, { exact: true })).toHaveAttribute("aria-current", "page");
  await crumbs.getByRole("button", { name: "Tài liệu của workspace" }).click();

  // 3. Move the docx into the folder from its row menu, then find it inside.
  await sidebar(page).getByRole("button", { name: "Thư mục của tôi", exact: true }).click();
  await expect(libraryRowButton(library(page), DOCX_TITLE)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: `Thao tác cho ${DOCX_TITLE}` }).click();
  await page.getByRole("menuitem", { name: "Di chuyển tới…" }).click();
  // FD-09: the Move-to picker is a tree (as documents-folders.spec.ts drives it); the pick is confirmed with "Di chuyển".
  const moveDialog = page.getByRole("dialog", { name: "Di chuyển tới" });
  await expect(moveDialog).toBeVisible();
  await moveDialog.getByRole("treeitem", { name: FOLDER_TITLE, exact: true }).click();
  await moveDialog.getByRole("button", { name: "Di chuyển", exact: true }).click();
  await expect(moveDialog).toBeHidden();
  await expect(page.getByText(`Đã chuyển tới ${FOLDER_TITLE}`)).toBeVisible({ timeout: 30_000 });
  await sidebar(page).getByRole("treeitem", { name: new RegExp(FOLDER_TITLE) }).click();
  await expect(page.getByRole("navigation", { name: "Đường dẫn thư mục" }).getByText(FOLDER_TITLE, { exact: true })).toBeVisible();
  await expect(libraryRowButton(library(page), DOCX_TITLE)).toBeVisible({ timeout: 30_000 });

  // 4. Other modules: visible while the API answers, with the task's file under
  // "Công việc"; hidden when the route is missing (an older server answers 404).
  await openLibrary(page, owner.orgSlug, owner.wsSlug);
  await expect(sidebar(page).getByText("Từ nơi khác")).toBeVisible({ timeout: 30_000 });
  await sidebar(page).getByRole("button", { name: "Công việc" }).click();
  await expect(page.getByText(SOURCE_FILE).first()).toBeVisible({ timeout: 30_000 });

  await page.route("**/api/v1/workspaces/*/documents/sources**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found" } }) }),
  );
  await openLibrary(page, owner.orgSlug, owner.wsSlug);
  await expect(sidebar(page).getByText("Thư mục", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(sidebar(page).getByText("Từ nơi khác")).toHaveCount(0);
  await page.unroute("**/api/v1/workspaces/*/documents/sources**");
});

test("My Folder sub-nav row, personal folder view, localized tree label, Home create into My Folder, and system folder guards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seed = workspaceSeed("dochome", "myfolder", stamp);
  await onboardDocumentsUser(page, seed);
  await openLibrary(page, seed.orgSlug, seed.wsSlug);

  const nav = sidebar(page);
  const myFolderNav = nav.getByRole("button", { name: "Thư mục của tôi", exact: true });
  await expect(myFolderNav).toBeVisible({ timeout: 30_000 });

  // 1. Clicking "Thư mục của tôi" ensures the personal folder, opens it as a folder view, and lists it in the tree with its i18n label.
  await myFolderNav.click();
  await expect(page).toHaveURL(/\/documents\?folder=[0-9A-HJKMNP-TV-Z]{26}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Thư mục của tôi", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(myFolderNav).toHaveAttribute("aria-current", "page");
  const myFolderTreeItem = nav.getByRole("treeitem", { name: /Thư mục của tôi/ });
  await expect(myFolderTreeItem).toBeVisible({ timeout: 30_000 });
  await expect(nav.getByText("My Folder", { exact: true })).toHaveCount(0);

  // 2. Guards on the open My Folder header and tree row: no inline rename, no Rename / Move / Delete in menus, while New subfolder stays available.
  const crumbs = page.getByRole("navigation", { name: "Đường dẫn thư mục" });
  await expect(crumbs.getByRole("button", { name: "Đổi tên thư mục" })).toHaveCount(0);
  await page.getByRole("button", { name: "Thao tác với thư mục" }).click();
  await expect(page.getByRole("menuitem", { name: "Thư mục con mới" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Đổi tên" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Di chuyển tới…" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Xóa thư mục…" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await myFolderTreeItem.getByRole("button", { name: "Thao tác cho Thư mục của tôi" }).click();
  await expect(page.getByRole("menuitem", { name: "Thư mục con mới" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Đổi tên…" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Di chuyển tới…" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Xóa thư mục…" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // 3. Creating from Documents Home (root) places the new document inside My Folder.
  await nav.getByRole("button", { name: "Tài liệu của workspace", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tài liệu của workspace", exact: true })).toBeVisible({ timeout: 30_000 });
  await quickCreate(page, /^UniNote/).click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });

  await openLibrary(page, seed.orgSlug, seed.wsSlug);
  await myFolderNav.click();
  await expect(libraryRowButton(library(page), "UniNote mới")).toBeVisible({ timeout: 30_000 });
});

test("the header Open UniWork Office falls back to the installer dialog when no app answers", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The header button shows only for a platform the installers cover, and the
  // guess reads the browser's UA hints: pin a Windows x64 desktop so the test
  // does not depend on the runner's OS or architecture (linux arm64 is unsupported).
  await page.addInitScript(() => {
    const hints = {
      platform: "Windows",
      mobile: false,
      brands: [],
      getHighEntropyValues: () => Promise.resolve({ architecture: "x86", bitness: "64" }),
    };
    Object.defineProperty(navigator, "userAgentData", { value: hints, configurable: true });
  });
  // The e2e server publishes no installer (OFFICE_INSTALLER_*_URLS stay empty), and
  // the dialog then offers no "Mở lại"; answer the installers route with one stable
  // Windows installer, with the CORS headers the cross-origin API call needs.
  await page.route("**/api/v1/office/desktop/download**", (route) => {
    const cors = {
      "access-control-allow-origin": route.request().headers().origin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: cors,
      body: JSON.stringify({
        installers: [{ platform: "win32-x64", kind: ".exe", url: "https://downloads.example.test/UniWork-Office-Setup.exe" }],
        supported_platforms: ["win32-x64"],
        server_origin: "https://office.example.test/",
        channel: "stable",
        client_id: "uniwork-office",
        deployment_id: "e2e-deployment",
      }),
    });
  });
  const seed = workspaceSeed("dochome", "launch", stamp);
  await onboardDocumentsUser(page, seed);

  // The bare-scheme launch carries no document, so no launch ticket may be asked for.
  const sessionCalls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/office\/sessions/.test(request.url())) sessionCalls.push(request.url());
  });

  await openLibrary(page, seed.orgSlug, seed.wsSlug);
  // Headless Chromium has no handler for the scheme and the page never loses
  // focus, so the launcher reports "not installed" after its wait.
  const open = page.getByRole("button", { name: "Mở UniWork Office" });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  const installer = page.getByRole("dialog", { name: "Tải UniWork Office cho máy tính" });
  await expect(installer).toBeVisible({ timeout: 30_000 });
  await expect(installer.getByRole("button", { name: "Mở lại" })).toBeVisible();
  expect(sessionCalls).toEqual([]);
});

/* ---- a viewer: no create controls, no commands the level refuses ------------------ */

let m: DocumentMatrix;
let sharedFolderTitle: string;
let sharedPageTitle: string;
let privatePageTitle: string;

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function userId(request: APIRequestContext, token: string): Promise<string> {
  const me = await request.get(`${api}/api/v1/me`, { headers: authHeaders(token) });
  expect(me.status(), await me.text()).toBe(200);
  return ((await me.json()) as { user: { id: string } }).user.id;
}

/** A restricted document of the owner's, shared with `viewerToken`'s user at view level. */
async function shareRestricted(request: APIRequestContext, kind: "folder" | "page", title: string, viewerId: string) {
  const created = await request.post(`${api}/api/v1/workspaces/${m.aOwner.wsId}/documents`, {
    headers: authHeaders(m.aOwner.token),
    data: { kind, title, visibility: "restricted" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = ((await created.json()) as { document: { id: string } }).document.id;
  const shared = await request.post(`${api}/api/v1/documents/${id}/shares`, {
    headers: authHeaders(m.aOwner.token),
    data: { principal_type: "user", principal_id: viewerId, level: "view" },
  });
  expect(shared.status(), await shared.text()).toBe(201);
}

test.describe("a view-only member", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      m = await documentMatrix(page, api, `dochome-viewer-${stamp}`);
      const viewerId = await userId(page.request, m.aOther.token);
      sharedFolderTitle = `Thư mục chỉ xem ${stamp}`;
      sharedPageTitle = `Trang chỉ xem ${stamp}`;
      privatePageTitle = `Trang riêng tư ${stamp}`;
      await shareRestricted(page.request, "folder", sharedFolderTitle, viewerId);
      await shareRestricted(page.request, "page", sharedPageTitle, viewerId);
      const privateCreated = await page.request.post(`${api}/api/v1/workspaces/${m.aOwner.wsId}/documents`, {
        headers: authHeaders(m.aOwner.token),
        data: { kind: "page", title: privatePageTitle, visibility: "restricted" },
      });
      expect(privateCreated.status(), await privateCreated.text()).toBe(201);
    } finally {
      await page.close();
    }
  });

  test("sees create controls at the root, none inside a folder shared at view level", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaUi(page, m.aOther.email);
    await openLibrary(page, m.aOwner.orgSlug, m.aOwner.wsSlug);

    // The root is open to every member of the workspace.
    await expect(page.getByRole("region", { name: "Tạo nhanh" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Tạo mới", exact: true })).toBeVisible();

    // The shared folder opens from the shared sidebar view; inside it the viewer creates nothing.
    await sidebar(page).getByRole("button", { name: "Được chia sẻ với tôi" }).click();
    await libraryRowButton(library(page), sharedFolderTitle).click();
    await expect(page.getByRole("navigation", { name: "Đường dẫn thư mục" }).getByText(sharedFolderTitle)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("region", { name: "Tạo nhanh" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tạo mới", exact: true })).toHaveCount(0);
    await expect(sidebar(page).getByRole("button", { name: "Tạo thư mục" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Đổi tên thư mục" })).toHaveCount(0);
  });

  test("gets no Move or Archive on a row shared at view level", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaUi(page, m.aOther.email);
    await openLibrary(page, m.aOwner.orgSlug, m.aOwner.wsSlug);

    // The row is on the home list (the share admits it) with the viewer's own level.
    await expect(libraryRowButton(library(page), sharedPageTitle)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: `Thao tác cho ${sharedPageTitle}` }).click();
    await expect(page.getByRole("menuitem", { name: "Mở trên web" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Di chuyển" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Chuyển vào thùng rác" })).toHaveCount(0);
  });

  test("lists shared documents under the owner's Tôi đã chia sẻ, excludes private ones, and keeps them out of the recipient's Tôi đã chia sẻ", async ({
    browser,
  }) => {
    const ownerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const recipientCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const ownerPage = await ownerCtx.newPage();
      await loginViaUi(ownerPage, m.aOwner.email);
      await openLibrary(ownerPage, m.aOwner.orgSlug, m.aOwner.wsSlug);

      await sidebar(ownerPage).getByRole("button", { name: "Tôi đã chia sẻ", exact: true }).click();
      await expect(ownerPage).toHaveURL(/\/documents\?view=shared-by-me$/);
      await expect(ownerPage.getByRole("heading", { level: 2, name: "Tôi đã chia sẻ", exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(libraryRowButton(library(ownerPage), sharedPageTitle)).toBeVisible({ timeout: 30_000 });
      await expect(libraryRowButton(library(ownerPage), privatePageTitle)).toHaveCount(0);

      const recipientPage = await recipientCtx.newPage();
      await loginViaUi(recipientPage, m.aOther.email);
      await openLibrary(recipientPage, m.aOwner.orgSlug, m.aOwner.wsSlug);

      await sidebar(recipientPage).getByRole("button", { name: "Tôi đã chia sẻ", exact: true }).click();
      await expect(recipientPage).toHaveURL(/\/documents\?view=shared-by-me$/);
      await expect(recipientPage.getByText("Chưa chia sẻ tài liệu nào", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(recipientPage.getByText(sharedPageTitle, { exact: true })).toHaveCount(0);

      await sidebar(recipientPage).getByRole("button", { name: "Được chia sẻ với tôi", exact: true }).click();
      await expect(libraryRowButton(library(recipientPage), sharedPageTitle)).toBeVisible({ timeout: 30_000 });
    } finally {
      await ownerCtx.close();
      await recipientCtx.close();
    }
  });
});
