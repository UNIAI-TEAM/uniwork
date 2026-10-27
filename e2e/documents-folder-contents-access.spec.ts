import { expect, test, type Locator, type Page, type Request, type Response } from "@playwright/test";
import { createFolder, createPage, folderCard } from "./documents-folders-fixtures";
import {
  buildShareScene,
  grantAccess,
  pickCandidate,
  sharesOf,
  toast,
  userItem,
  who,
  type AccessItem,
  type ShareScene,
} from "./documents-share-fixtures";
import { loginViaUi } from "./meeting-recording-fixture";

/**
 * UNI-2244 e2e: "Chia sẻ các tài liệu bên trong…" (addendum
 * docs/superpowers/specs/2026-10-27-documents-folder-bulk-access-addendum.md §1-§3, §7)
 * on the real stack. The actor is a plain workspace member who owns the folder
 * (implicit admins can administer everything, so the owner or admin would never
 * see a skipped document). Each test seeds its own folder tree, so the file runs
 * in any order. Server truth is read back through GET /shares.
 *
 * Needs the same runtime as documents-share.spec.ts (FF_DOCUMENTS on, Team plan
 * seeded by the fixture scene).
 */
test.describe.configure({ timeout: 360_000 });

const tag = `fca2244-${Date.now().toString(36)}`;
let s: ShareScene;

/** Every locator of the dialog in one place, so a rename in the views touches only this block. */
const L = {
  tree: (page: Page): Locator => page.getByRole("tree", { name: "Cây tài liệu" }),
  treeMenu: (page: Page, title: string): Locator =>
    L.tree(page).getByRole("button", { name: `Thao tác cho ${title}`, exact: true }),
  menuItem: (page: Page): Locator => page.getByTestId("folder-access-menu-item"),
  dialog: (page: Page): Locator => page.getByTestId("folder-access-dialog"),
  dialogTitle: (dialog: Locator): Locator => dialog.getByRole("heading", { name: DIALOG_TITLE, exact: true }),
  cardMenu: (page: Page, folderTitle: string): Locator =>
    folderCard(page, folderTitle).getByRole("button", { name: `Thao tác cho ${folderTitle}`, exact: true }),
  cardOpen: (page: Page, folderTitle: string): Locator => folderCard(page, folderTitle).getByRole("button").first(),
  headerMenu: (page: Page): Locator => page.getByRole("button", { name: "Thao tác với thư mục", exact: true }),
  mode: (dialog: Locator): Locator => dialog.getByTestId("folder-access-mode"),
  modeOption: (page: Page, mode: "merge" | "replace"): Locator => page.getByTestId(`folder-access-mode-${mode}`),
  confirm: (dialog: Locator): Locator => dialog.getByTestId("folder-access-confirm"),
  apply: (dialog: Locator): Locator => dialog.getByTestId("folder-access-apply"),
  summary: (dialog: Locator): Locator => dialog.getByTestId("folder-access-summary"),
  warning: (dialog: Locator, code: string): Locator => dialog.getByTestId(`folder-access-warning-${code}`),
  workspaceRow: (dialog: Locator): Locator => dialog.getByTestId("folder-access-workspace-row"),
  workspaceLevel: (dialog: Locator): Locator => dialog.getByTestId("folder-access-workspace-level"),
  principalRow: (dialog: Locator, principalId: string): Locator => dialog.getByTestId(`folder-access-principal-${principalId}`),
  principalLevel: (row: Locator, name: string): Locator => row.getByRole("combobox", { name: `Mức quyền của ${name}` }),
  back: (dialog: Locator): Locator => dialog.getByRole("button", { name: "Quay lại", exact: true }),
  option: (page: Page, name: string): Locator => page.getByRole("option", { name, exact: true }),
};

/** documents.folderAccess.title / .subtitle in packages/core/i18n/locales/vi.json. */
const DIALOG_TITLE = "Chia sẻ";
const subtitleOf = (folderTitle: string): string => `Áp dụng cho các tài liệu trong thư mục "${folderTitle}" và thư mục con.`;

interface Tree {
  folder: { id: string; title: string };
  /** Pages the actor manages: one in the folder, one in the subfolder (recursion proof). */
  managed: string[];
  /** A page in the subfolder owned by someone else, shared to the actor at View: not manageable. */
  foreign: string;
}

interface Dto {
  mode?: string;
  items?: { principal_type: string; principal_id: string; level: string }[];
  dry_run?: boolean;
}

interface DryRunBody {
  total: number;
  preview: {
    changed: number;
    unchanged: number;
    skipped_not_manageable: number;
    skipped_locked: number;
    losing_users: number;
    downgraded_users: number;
    warnings: string[];
  };
}

interface SyncBody {
  batch_id: string;
  mode: string;
  total: number;
  changed: number;
  unchanged: number;
  skipped_not_manageable: number;
  skipped_locked: number;
}

const stamp = Date.now();
let seq = 0;
const title = (what: string): string => {
  seq += 1;
  return `FCA ${what} ${stamp}-${seq}`;
};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  const page = await browser.newPage();
  try {
    s = await buildShareScene(page, tag, 1);
  } finally {
    await page.close();
  }
});

/**
 * The member owns folder F, subfolder S, a page in F and a page in S. Another
 * member adds a page to S (a workspace folder takes children from every member)
 * and shares it to the member at View, so it is readable but not manageable.
 */
async function seedTree(page: Page): Promise<Tree> {
  const ws = s.m.aOwner.wsId;
  const folder = await createFolder(page, s.member.token, ws, title("folder"));
  const sub = await createFolder(page, s.member.token, ws, title("sub"), folder.id);
  const inFolder = await createPage(page, s.member.token, ws, title("page"), folder.id);
  const inSub = await createPage(page, s.member.token, ws, title("deep"), sub.id);
  const foreign = await createPage(page, s.other.token, ws, title("foreign"), sub.id);
  await grantAccess(page.request, s.other.token, foreign.id, [userItem(s.member, "view")]);
  return { folder: { id: folder.id, title: folder.title }, managed: [inFolder.id, inSub.id], foreign: foreign.id };
}

/** Active direct shares as "type:id:level" plus the home row level, the part of GET /shares these tests compare. */
async function accessOf(page: Page, token: string, docId: string): Promise<{ shares: string[]; home: string | null }> {
  const body = await sharesOf(page.request, token, docId);
  return {
    shares: (body.shares ?? []).filter((r) => r.active).map((r) => `${r.principal_type}:${r.principal_id}:${r.level}`).sort(),
    home: body.home_workspace?.level ?? null,
  };
}

async function signInMember(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginViaUi(page, s.member.email);
}

/** The folder's row menu in the sidebar tree (the card menu has no such item), then the bulk item: returns the open dialog. */
async function openFolderAccess(page: Page, folderTitle: string): Promise<Locator> {
  await page.goto(`/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/documents`);
  const row = L.tree(page).getByRole("treeitem", { name: folderTitle });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await L.treeMenu(page, folderTitle).click();
  await expect(L.menuItem(page)).toBeVisible();
  await L.menuItem(page).click();
  return expectDialogFor(page, folderTitle);
}

/** The open dialog carries the new title and the subtitle naming the folder. */
async function expectDialogFor(page: Page, folderTitle: string): Promise<Locator> {
  const dialog = L.dialog(page);
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(L.dialogTitle(dialog)).toBeVisible();
  await expect(dialog).toContainText(subtitleOf(folderTitle));
  return dialog;
}

/** The JSON a request carried; the helpers only call it on the folder-access PUTs. */
function sentBody(req: Request): Dto {
  const body: Dto = req.postDataJSON();
  return body;
}

function isFolderAccessPut(res: Response, folderId: string, dryRun: boolean): boolean {
  const req = res.request();
  if (req.method() !== "PUT" || new URL(res.url()).pathname !== `/api/v1/documents/${folderId}/contents-access`) return false;
  return Boolean(sentBody(req).dry_run) === dryRun;
}

/** Clicks `button` and returns the PUT .../contents-access answer for the given phase. */
async function clickAndWaitPut(page: Page, button: Locator, folderId: string, dryRun: boolean): Promise<Response> {
  const answer = page.waitForResponse((res) => isFolderAccessPut(res, folderId, dryRun), { timeout: 30_000 });
  await button.click();
  return answer;
}

test("merge: dry run counts the skipped document, apply writes the subtree and leaves the foreign page alone", async ({ page }) => {
  const tree = await seedTree(page);
  const foreignBefore = await accessOf(page, s.other.token, tree.foreign);
  await signInMember(page);
  const dialog = await openFolderAccess(page, tree.folder.title);

  // The default mode is merge: pick another member at Edit.
  await pickCandidate(dialog, s.other.name, who(s.other.name));
  const row = L.principalRow(dialog, s.other.id);
  await expect(row).toBeVisible();
  await L.principalLevel(row, s.other.name).click();
  await L.option(page, "Chỉnh sửa").click();

  const dry = await clickAndWaitPut(page, L.confirm(dialog), tree.folder.id, true);
  expect(dry.status(), await dry.text()).toBe(200);
  const dryBody = (await dry.json()) as DryRunBody;
  expect(dryBody.total).toBe(3);
  expect(dryBody.preview.changed).toBe(2);
  expect(dryBody.preview.skipped_not_manageable).toBe(1);
  const dryReq = sentBody(dry.request());
  expect(dryReq.mode).toBe("merge");
  expect(dryReq.items).toEqual([{ principal_type: "user", principal_id: s.other.id, level: "edit" }]);
  await expect(L.summary(dialog)).toContainText("Sẽ đổi 2 tài liệu");
  await expect(L.summary(dialog)).toContainText("bỏ qua 1 tài liệu bạn không quản lý");
  // A dry run writes nothing.
  for (const id of tree.managed) expect((await accessOf(page, s.member.token, id)).shares).toEqual([]);

  const applied = await clickAndWaitPut(page, L.apply(dialog), tree.folder.id, false);
  expect(applied.status(), await applied.text()).toBe(200);
  const body = (await applied.json()) as SyncBody;
  expect(body.mode).toBe("sync");
  expect(body).toMatchObject({ total: 3, changed: 2, unchanged: 0, skipped_not_manageable: 1, skipped_locked: 0 });
  expect(applied.request().postDataJSON()).toEqual({ ...dryReq, dry_run: false });
  await toast(page, "Đã đổi quyền 2 tài liệu");
  await toast(page, "Bỏ qua 1 tài liệu bạn không quản lý.");
  await expect(dialog).toBeHidden();

  // Both managed pages, the one in the subfolder included, carry the level; the foreign page is untouched.
  for (const id of tree.managed) {
    expect((await accessOf(page, s.member.token, id)).shares).toContain(`user:${s.other.id}:edit`);
  }
  expect(await accessOf(page, s.other.token, tree.foreign)).toEqual(foreignBefore);
});

test("replace: Confirm waits for a workspace choice, then the shares are exactly the chosen set", async ({ page }) => {
  const tree = await seedTree(page);
  // Existing access the replace must take away: the other member holds Edit on both managed pages. The first page also
  // has a home-workspace share at View: the server warns to_private only when a home-workspace share exists before
  // the replace (UNI-2244 Amendment A1), and seeded pages are private.
  const homeView: AccessItem = { principal_type: "workspace", principal_id: s.m.aOwner.wsId, level: "view", on_existing: "update" };
  await grantAccess(page.request, s.member.token, tree.managed[0]!, [userItem(s.other, "edit"), homeView]);
  await grantAccess(page.request, s.member.token, tree.managed[1]!, [userItem(s.other, "edit")]);
  const foreignBefore = await accessOf(page, s.other.token, tree.foreign);
  const extra = s.extras[0]!;

  await signInMember(page);
  const dialog = await openFolderAccess(page, tree.folder.title);
  await L.mode(dialog).click();
  await L.modeOption(page, "replace").click();
  await expect(L.workspaceRow(dialog)).toBeVisible();

  // Card rule: the workspace row starts unset and Confirm refuses to run until a level or Riêng tư is picked.
  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/contents-access")) sent.push(req.method());
  });
  await expect(L.confirm(dialog)).toHaveAttribute("aria-disabled", "true");
  await L.confirm(dialog).click({ force: true });
  // Negative check: give a wrongly enabled button time to send its dry run.
  await page.waitForTimeout(750);
  expect(sent).toEqual([]);
  await expect(L.summary(dialog)).toHaveCount(0);

  // Riêng tư with nobody picked: the documents go Private and the other member loses access.
  await L.workspaceLevel(dialog).click();
  await L.option(page, "Riêng tư").click();
  await expect(L.confirm(dialog)).not.toHaveAttribute("aria-disabled", "true");
  const dryPrivate = await clickAndWaitPut(page, L.confirm(dialog), tree.folder.id, true);
  expect(dryPrivate.status(), await dryPrivate.text()).toBe(200);
  const privateBody = (await dryPrivate.json()) as DryRunBody;
  expect(privateBody.preview).toMatchObject({ changed: 2, skipped_not_manageable: 1 });
  // Workspace members may now count as losing access too, so only a lower bound holds.
  expect(privateBody.preview.losing_users).toBeGreaterThanOrEqual(1);
  expect(privateBody.preview.warnings).toContain("to_private");
  expect(sentBody(dryPrivate.request()).items).toEqual([]);
  await expect(L.summary(dialog)).toContainText(/\d+ người mất quyền ở ít nhất một tài liệu/);
  await expect(L.warning(dialog, "to_private")).toBeVisible();

  // Back, keep the workspace at View and add one person at Comment: that exact set is written.
  await L.back(dialog).click();
  await L.workspaceLevel(dialog).click();
  await L.option(page, "Chỉ xem").click();
  await pickCandidate(dialog, extra.name, who(extra.name));
  await L.principalLevel(L.principalRow(dialog, extra.id), extra.name).click();
  await L.option(page, "Nhận xét").click();

  const dry = await clickAndWaitPut(page, L.confirm(dialog), tree.folder.id, true);
  expect(dry.status(), await dry.text()).toBe(200);
  const dryBody = (await dry.json()) as DryRunBody;
  // The other member is a workspace member: with the workspace kept at View they still read every page, so nobody
  // loses access here (r4 cloud: losing_users 0); the Private dry run above is the loss case.
  expect(dryBody.preview).toMatchObject({ changed: 2, skipped_not_manageable: 1, losing_users: 0 });
  expect(dryBody.preview.warnings).not.toContain("to_private");
  await expect(L.warning(dialog, "to_private")).toHaveCount(0);
  await expect(L.summary(dialog)).toContainText("bỏ qua 1 tài liệu bạn không quản lý");
  // Nothing was written by the dry runs.
  for (const id of tree.managed) expect((await accessOf(page, s.member.token, id)).shares).toContain(`user:${s.other.id}:edit`);

  await expect(L.apply(dialog)).toHaveText("Thay thế quyền");
  const applied = await clickAndWaitPut(page, L.apply(dialog), tree.folder.id, false);
  expect(applied.status(), await applied.text()).toBe(200);
  const body = (await applied.json()) as SyncBody;
  expect(body.mode).toBe("sync");
  expect(body).toMatchObject({ total: 3, changed: 2, skipped_not_manageable: 1, skipped_locked: 0 });
  await toast(page, "Đã đổi quyền 2 tài liệu");
  await expect(dialog).toBeHidden();

  for (const id of tree.managed) {
    expect(await accessOf(page, s.member.token, id)).toEqual({ shares: [`user:${extra.id}:comment`], home: "view" });
  }
  expect(await accessOf(page, s.other.token, tree.foreign)).toEqual(foreignBefore);
});

test("card menu: the home folder card menu opens the same dialog", async ({ page }) => {
  const tree = await seedTree(page);
  await signInMember(page);
  await page.goto(`/${s.m.aOwner.orgSlug}/${s.m.aOwner.wsSlug}/documents`);
  const card = folderCard(page, tree.folder.title);
  await expect(card).toBeVisible({ timeout: 60_000 });
  const puts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().includes("/contents-access")) puts.push(req.url());
  });

  await card.hover();
  await L.cardMenu(page, tree.folder.title).click();
  await expect(L.menuItem(page)).toBeVisible();
  await L.menuItem(page).click();
  const dialog = await expectDialogFor(page, tree.folder.title);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The open folder's header menu carries the same item.
  await L.cardOpen(page, tree.folder.title).click();
  await expect(L.headerMenu(page)).toBeVisible({ timeout: 30_000 });
  await L.headerMenu(page).click();
  await expect(L.menuItem(page)).toBeVisible();
  await L.menuItem(page).click();
  await expectDialogFor(page, tree.folder.title);
  await page.keyboard.press("Escape");
  await expect(L.dialog(page)).toBeHidden();
  expect(puts).toEqual([]);
});

test("202 background batch: progress bar and toast on completion", async () => {
  test.skip(
    true,
    "FolderContentsAccessSyncMax=500 is a Go const with no runtime or env override (SetFolderContentsAccessSyncMax is test-only); the 202 path is covered by the Go handler and service tests",
  );
});
